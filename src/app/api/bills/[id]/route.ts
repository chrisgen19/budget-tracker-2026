import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { scheduledTransactionSchema } from "@/lib/validations";
import { advanceToNextUnpaidOccurrence, utcDayStart } from "@/lib/bill-utils";

const billInclude = {
  category: true,
  labels: { include: { label: true } },
} as const;

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

    // Recalculate nextDueDate if frequency or startDate changed. Walk forward
    // from the new startDate past any PAID/SKIPPED logs so payment progress is
    // preserved (fixes bug where editing a bill reset nextDueDate and
    // resurrected already-paid occurrences).
    const frequencyChanged = billData.frequency !== existing.frequency
      || billData.customIntervalDays !== existing.customIntervalDays;
    const startDateChanged = startDate.getTime() !== existing.startDate.getTime();
    const needsRecalculate = frequencyChanged || startDateChanged;

    let recalculatedNextDue: Date | null = null;
    if (needsRecalculate) {
      const logs = await prisma.scheduledTransactionLog.findMany({
        where: { scheduledTransactionId: id },
        select: { dueDate: true, status: true },
      });
      recalculatedNextDue = advanceToNextUnpaidOccurrence(
        startDate,
        billData.frequency,
        startDate.getDate(),
        billData.customIntervalDays ?? null,
        logs,
        { endDate },
      );
    }

    const bill = await prisma.$transaction(async (tx) => {
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
          description: billData.description,
          type: billData.type,
          frequency: billData.frequency,
          customIntervalDays: billData.customIntervalDays ?? null,
          reminderDaysBefore: billData.reminderDaysBefore,
          startDate,
          endDate,
          ...(needsRecalculate && recalculatedNextDue && { nextDueDate: recalculatedNextDue }),
          ...(needsRecalculate && !recalculatedNextDue && { isActive: false }),
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

  // Reactivate and reset nextDueDate to today if it's in the past. UTC, because this value can
  // be *written* as a due date, and every reader takes due dates to be at UTC midnight.
  const today = utcDayStart(new Date());
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
