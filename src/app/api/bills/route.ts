import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { scheduledTransactionSchema } from "@/lib/validations";
import { advanceToNextUnpaidOccurrence } from "@/lib/bill-utils";
import { createBill } from "@/lib/bill-writes";
import type { BillOccurrenceStatus } from "@/types";

const billInclude = {
  category: true,
  labels: { include: { label: true } },
} as const;

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const active = searchParams.get("active");
  const type = searchParams.get("type");

  const where: Record<string, unknown> = { userId };

  if (active === "true") where.isActive = true;
  if (active === "false") where.isActive = false;
  if (type === "INCOME" || type === "EXPENSE") where.type = type;

  const bills = await prisma.scheduledTransaction.findMany({
    where,
    include: billInclude,
    orderBy: { nextDueDate: "asc" },
  });

  // Compute displayNextDueDate per bill by walking forward past PAID/SKIPPED
  // logs. This is a read-only derivation — it doesn't mutate nextDueDate, so
  // it's safe to run on every list request. The UI should prefer this field
  // over raw nextDueDate for overdue/due labels.
  const billIds = bills.map((b) => b.id);
  const logs = billIds.length
    ? await prisma.scheduledTransactionLog.findMany({
        where: {
          scheduledTransactionId: { in: billIds },
          status: { in: ["PAID", "SKIPPED"] },
        },
        select: { scheduledTransactionId: true, dueDate: true, status: true },
      })
    : [];

  const logsByBillId = new Map<string, Array<{ dueDate: Date; status: BillOccurrenceStatus }>>();
  for (const log of logs) {
    const arr = logsByBillId.get(log.scheduledTransactionId) ?? [];
    arr.push({ dueDate: log.dueDate, status: log.status });
    logsByBillId.set(log.scheduledTransactionId, arr);
  }

  const withDisplay = bills.map((bill) => {
    const billLogs = logsByBillId.get(bill.id) ?? [];
    const display = advanceToNextUnpaidOccurrence(
      bill.nextDueDate,
      bill.frequency,
      bill.startDate.getUTCDate(),
      bill.customIntervalDays,
      billLogs,
      { endDate: bill.endDate },
    );
    return {
      ...bill,
      displayNextDueDate: (display ?? bill.nextDueDate).toISOString(),
    };
  });

  return NextResponse.json(withDisplay);
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = scheduledTransactionSchema.parse(body);

    const { labelIds, ...billData } = validated;

    // Shared with the MCP `create_bill` tool. The ownership check inside it is stricter than what
    // this route used to do -- it trusted whatever `categoryId` it was handed -- which the form
    // cannot trip, since it can only offer the user's own categories of the right type.
    const result = await createBill({
      prisma,
      userId,
      input: {
        amount: billData.amount,
        description: billData.description,
        type: billData.type,
        categoryId: billData.categoryId,
        frequency: billData.frequency,
        customIntervalDays: billData.customIntervalDays ?? null,
        reminderDaysBefore: billData.reminderDaysBefore,
        isVariable: billData.isVariable ?? false,
        startDate: new Date(billData.startDate),
        endDate: billData.endDate ? new Date(billData.endDate) : null,
        isActive: true,
      },
      labelIds,
    });

    if (!result.ok) {
      // Every deterministic refusal is a 4xx and says which field to repair. A reason added to
      // `createBill` and not listed here fell through to a 500, which tells the client the server
      // broke and the request was fine -- the opposite of true, and not retryable in the way a
      // 500 implies. `LABELS_NOT_IN_CATEGORY` shipped in exactly that state.
      const refusals: Partial<Record<typeof result.reason, string>> = {
        CATEGORY_NOT_USABLE:
          "That category does not exist, or its type does not match the bill's.",
        LABELS_NOT_OWNED: "One or more labels are invalid or do not belong to you.",
        LABELS_NOT_IN_CATEGORY:
          "One or more labels cannot be used on a bill in this category.",
        INVALID_SCHEDULE:
          "That schedule is not usable: a custom frequency needs an interval, and an end date cannot fall before the start date.",
      };
      const error = refusals[result.reason];
      return error
        ? NextResponse.json({ error }, { status: 400 })
        : NextResponse.json({ error: "Failed to create bill" }, { status: 500 });
    }

    return NextResponse.json(result.bill, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create bill" }, { status: 500 });
  }
}
