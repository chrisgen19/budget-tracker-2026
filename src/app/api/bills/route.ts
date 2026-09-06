import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { scheduledTransactionSchema } from "@/lib/validations";
import { advanceToNextUnpaidOccurrence } from "@/lib/bill-utils";
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

    const startDate = new Date(validated.startDate);
    const { labelIds, ...billData } = validated;

    const bill = await prisma.$transaction(async (tx) => {
      // Validate label ownership + type compatibility
      let verifiedLabelIds: string[] = [];
      if (labelIds && labelIds.length > 0) {
        const owned = await tx.label.findMany({
          where: { id: { in: labelIds }, userId },
          select: { id: true, applicableTo: true },
        });
        verifiedLabelIds = owned
          .filter((l) => l.applicableTo === "BOTH" || l.applicableTo === billData.type)
          .map((l) => l.id);
      }

      return tx.scheduledTransaction.create({
        data: {
          amount: billData.amount,
          isVariable: billData.isVariable ?? false,
          description: billData.description,
          type: billData.type,
          frequency: billData.frequency,
          customIntervalDays: billData.customIntervalDays ?? null,
          reminderDaysBefore: billData.reminderDaysBefore,
          startDate,
          endDate: billData.endDate ? new Date(billData.endDate) : null,
          nextDueDate: startDate,
          categoryId: billData.categoryId,
          userId,
          ...(verifiedLabelIds.length > 0 && {
            labels: {
              create: verifiedLabelIds.map((id) => ({ labelId: id })),
            },
          }),
        },
        include: billInclude,
      });
    });

    return NextResponse.json(bill, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create bill" }, { status: 500 });
  }
}
