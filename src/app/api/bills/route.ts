import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { scheduledTransactionSchema } from "@/lib/validations";
import { advanceToNextUnpaidOccurrence } from "@/lib/bill-utils";
import type { BillOccurrenceStatus } from "@/types";

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
    include: { category: true },
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
      bill.startDate.getDate(),
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

    const startDate = new Date(validated.startDate);

    const bill = await prisma.scheduledTransaction.create({
      data: {
        amount: validated.amount,
        description: validated.description,
        type: validated.type,
        frequency: validated.frequency,
        customIntervalDays: validated.customIntervalDays ?? null,
        reminderDaysBefore: validated.reminderDaysBefore,
        startDate,
        endDate: validated.endDate ? new Date(validated.endDate) : null,
        nextDueDate: startDate,
        categoryId: validated.categoryId,
        userId,
      },
      include: { category: true },
    });

    return NextResponse.json(bill, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create bill" }, { status: 500 });
  }
}
