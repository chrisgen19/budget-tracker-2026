import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { categoriesAreUsable } from "@/lib/transaction-writes";
import { scheduledTransactionSchema } from "@/lib/validations";
import { advanceToNextUnpaidOccurrence } from "@/lib/bill-utils";
import { lockBillRow } from "@/lib/bill-writes";
import { userToday } from "@/lib/bill-dates";
import type { Prisma, ScheduledTransaction } from "@prisma/client";
import type { ScheduledTransactionInput } from "@/lib/validations";

const billInclude = {
  category: true,
  labels: { include: { label: true } },
} as const;

/**
 * Everything the schedule decides, derived from the **locked** row.
 *
 * Read before the transaction it was a read-then-write across an unlocked gap, and both halves
 * were wrong under a concurrent `settleBill`. The walk reads occurrence logs, so a payment
 * committing in between is invisible to it and the stale result puts the cursor back on the
 * occurrence just settled -- which `alreadySettled` then refuses for ever, reminders stuck on it.
 * And `ranOut` reads the cursor, so a settlement advancing it past a new end date arrives after
 * the check and the bill stays active past its own end, which is the whole defect this route was
 * fixed for. Same rule, same reason as `updateBill`.
 */
const deriveSchedule = async (
  tx: Prisma.TransactionClient,
  locked: ScheduledTransaction,
  billData: Omit<ScheduledTransactionInput, "labelIds">,
  startDate: Date,
  endDate: Date | null,
) => {
  // `?? null` on both sides, matching what the update writes. The schema leaves
  // `customIntervalDays` *absent* on every non-custom bill while the column holds `null`, so a
  // bare `!==` made `frequencyChanged` true on every edit of one: each save re-walked the
  // schedule from `startDate`, dragging a cursor that a snooze or a manual advance had moved
  // back onto the first occurrence the walk found.
  const frequencyChanged = billData.frequency !== locked.frequency
    || (billData.customIntervalDays ?? null) !== locked.customIntervalDays;
  const startDateChanged = startDate.getTime() !== locked.startDate.getTime();

  // Recalculate nextDueDate if frequency or startDate changed. Walk forward from the new
  // startDate past any PAID/SKIPPED logs so payment progress is preserved (fixes bug where
  // editing a bill reset nextDueDate and resurrected already-paid occurrences).
  const needsRecalculate = frequencyChanged || startDateChanged;

  let recalculatedNextDue: Date | null = null;
  if (needsRecalculate) {
    const logs = await tx.scheduledTransactionLog.findMany({
      where: { scheduledTransactionId: locked.id },
      select: { dueDate: true, status: true },
    });
    recalculatedNextDue = advanceToNextUnpaidOccurrence(
      startDate,
      billData.frequency,
      startDate.getUTCDate(),
      billData.customIntervalDays ?? null,
      logs,
      { endDate },
    );
  }

  /**
   * An end date is deliberately *not* part of `needsRecalculate`.
   *
   * Moving it does not change where the recurrence falls, only where it stops, so re-walking
   * from `startDate` would rewrite a cursor that is already correct -- and the walk only skips
   * terminal logs, so a cursor sitting ahead for any other reason would be dragged backwards by
   * an edit that had nothing to do with it.
   *
   * What an end date *can* do is leave the cursor pointing past the schedule's own end. Nothing
   * downstream filters on `endDate` -- `getUpcomingBills`, `/api/bills/upcoming` and
   * `pending-bills.ts` all select on `isActive` alone -- so such a bill showed as permanently
   * overdue and kept mailing reminders until somebody settled it by hand (#240). Same rule as
   * `updateBill` in `src/lib/bill-writes.ts`, which is the MCP path onto the same row.
   */
  const cursor = needsRecalculate ? recalculatedNextDue : locked.nextDueDate;
  const ranOut = cursor === null || (endDate !== null && cursor > endDate);

  return { needsRecalculate, recalculatedNextDue, ranOut };
};

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const existing = await prisma.scheduledTransaction.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const body = await request.json();
    const validated = scheduledTransactionSchema.parse(body);

    const startDate = new Date(validated.startDate);
    const { labelIds, ...billData } = validated;
    const endDate = billData.endDate ? new Date(billData.endDate) : null;

    const bill = await prisma.$transaction(async (tx) => {
      // First statement, as in `settleBill` and `updateBill`: the update below takes FOR KEY
      // SHARE through its foreign keys, so upgrading to FOR UPDATE afterwards deadlocks. It also
      // serialises this edit against a concurrent settlement, which is what the derivation needs
      // to be sound.
      await lockBillRow(tx, id);
      const locked = await tx.scheduledTransaction.findUniqueOrThrow({ where: { id } });
      const { needsRecalculate, recalculatedNextDue, ranOut } = await deriveSchedule(
        tx,
        locked,
        billData,
        startDate,
        endDate,
      );

      // The category has to be one this caller may actually use, which nothing here checked.
      //
      // `createBill` and `updateBill` both run `categoriesAreUsable`; this route keeps its own
      // implementation and simply wrote whatever `categoryId` arrived. The bill is ownership-
      // checked, the category was not, so a caller could point their own bill at somebody else's
      // category id (CWE-639) -- and `billInclude` returns `category`, so the response handed
      // back that category's name, icon and colour. It also let the type pair disagree, which is
      // the state `PUT /api/categories/[id]` goes to some length to keep out of the database.
      //
      // Judged only where the pair actually moves, matching `updateBill` and `updateTransactions`:
      // a bill left mismatched by a category type flip must stay editable, or the only way out of
      // that state is closed.
      const categoryPairMoved =
        billData.categoryId !== locked.categoryId || billData.type !== locked.type;
      if (categoryPairMoved) {
        const usable = await categoriesAreUsable(tx, userId, [
          { categoryId: billData.categoryId, type: billData.type },
        ]);
        if (!usable) {
          return {
            refusal: "That category does not exist, or its type does not match the bill's.",
          } as const;
        }
      }

      // Validate label ownership + type compatibility
      let verifiedLabelIds: string[] | undefined;
      if (labelIds !== undefined) {
        if (labelIds.length > 0) {
          const owned = await tx.label.findMany({
            where: { id: { in: labelIds }, userId },
            select: { id: true, applicableTo: true },
          });
          verifiedLabelIds = owned
            .filter((l) => l.applicableTo === "BOTH" || l.applicableTo === billData.type)
            .map((l) => l.id);
        } else {
          verifiedLabelIds = [];
        }
      }

      const updated = await tx.scheduledTransaction.update({
        where: { id },
        data: {
          amount: billData.amount,
          // Absent means "unchanged", not "false": an update that does not
          // resend the flag must not silently un-mark a variable bill.
          ...(billData.isVariable !== undefined && { isVariable: billData.isVariable }),
          description: billData.description,
          type: billData.type,
          frequency: billData.frequency,
          customIntervalDays: billData.customIntervalDays ?? null,
          reminderDaysBefore: billData.reminderDaysBefore,
          startDate,
          endDate,
          ...(needsRecalculate && recalculatedNextDue && { nextDueDate: recalculatedNextDue }),
          ...(ranOut && { isActive: false }),
          categoryId: billData.categoryId,
        },
        include: billInclude,
      });

      // Sync labels if explicitly provided
      if (verifiedLabelIds !== undefined) {
        await tx.billLabel.deleteMany({ where: { scheduledTransactionId: id } });
        if (verifiedLabelIds.length > 0) {
          await tx.billLabel.createMany({
            data: verifiedLabelIds.map((labelId) => ({
              scheduledTransactionId: id,
              labelId,
            })),
          });
        }
        // Re-fetch to include updated labels
        return tx.scheduledTransaction.findUniqueOrThrow({
          where: { id },
          include: billInclude,
        });
      }

      return updated;
    });

    // Carried out of the transaction as a value rather than thrown: the check runs before the
    // update, so nothing was written and there is nothing to roll back. Throwing would reach the
    // catch below and be reported as a 500, which is the opposite of what a refusal means.
    if ("refusal" in bill) {
      return NextResponse.json({ error: bill.refusal }, { status: 400 });
    }

    return NextResponse.json(bill);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update bill" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.scheduledTransaction.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  if (existing.isActive) {
    return NextResponse.json({ error: "Bill is already active" }, { status: 400 });
  }

  // Reactivate and reset nextDueDate to today if it's in the past. "Today" is the *user's*
  // calendar day encoded at UTC midnight: between their midnight and UTC's, a plain
  // `utcDayStart(new Date())` is still yesterday, so the bill would come back already overdue.
  const { timezoneOffset } = (await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true },
  })) ?? { timezoneOffset: 0 };
  const today = userToday(timezoneOffset ?? 0);
  const nextDueDate = existing.nextDueDate < today ? today : existing.nextDueDate;

  const bill = await prisma.scheduledTransaction.update({
    where: { id },
    data: {
      isActive: true,
      nextDueDate,
      endDate: null,
    },
    include: billInclude,
  });

  return NextResponse.json(bill);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.scheduledTransaction.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  // Soft delete — preserves history
  await prisma.scheduledTransaction.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ message: "Bill deactivated" });
}
