import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { billActionSchema } from "@/lib/validations";
import { computeNextDueDate } from "@/lib/bill-utils";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const bill = await prisma.scheduledTransaction.findUnique({
      where: { id },
      include: { category: true },
    });

    if (!bill || bill.userId !== userId) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const body = await request.json();
    const { action, dueDate: dueDateStr, transactionId: existingTransactionId, snoozeDays } = billActionSchema.parse(body);
    const dueDate = new Date(dueDateStr);

    const originalStartDay = bill.startDate.getDate();

    if (action === "pay") {
      // Create the real transaction
      const transaction = await prisma.transaction.create({
        data: {
          amount: bill.amount,
          description: bill.description,
          type: bill.type,
          date: dueDate,
          categoryId: bill.categoryId,
          userId,
        },
      });

      // Log the payment
      await prisma.scheduledTransactionLog.create({
        data: {
          scheduledTransactionId: bill.id,
          dueDate,
          status: "PAID",
          actionDate: new Date(),
          transactionId: transaction.id,
        },
      });

      // Advance nextDueDate
      const nextDue = computeNextDueDate(dueDate, bill.frequency, originalStartDay, bill.customIntervalDays);

      // If past endDate, deactivate
      const shouldDeactivate = bill.endDate && nextDue > bill.endDate;

      await prisma.scheduledTransaction.update({
        where: { id },
        data: {
          nextDueDate: nextDue,
          ...(shouldDeactivate && { isActive: false }),
        },
      });

      return NextResponse.json({ message: "Bill paid", transactionId: transaction.id });
    }

    if (action === "pay_existing") {
      // Log payment for an already-created transaction (used by "Pay & Edit" flow)
      await prisma.scheduledTransactionLog.create({
        data: {
          scheduledTransactionId: bill.id,
          dueDate,
          status: "PAID",
          actionDate: new Date(),
          transactionId: existingTransactionId,
        },
      });

      // Advance nextDueDate
      const nextDue = computeNextDueDate(dueDate, bill.frequency, originalStartDay, bill.customIntervalDays);
      const shouldDeactivate = bill.endDate && nextDue > bill.endDate;

      await prisma.scheduledTransaction.update({
        where: { id },
        data: {
          nextDueDate: nextDue,
          ...(shouldDeactivate && { isActive: false }),
        },
      });

      return NextResponse.json({ message: "Bill marked as paid" });
    }

    if (action === "snooze") {
      // Snooze for N days (default 1) — do NOT advance nextDueDate
      const days = snoozeDays ?? 1;
      const snoozeUntil = new Date();
      snoozeUntil.setDate(snoozeUntil.getDate() + days);
      snoozeUntil.setHours(0, 0, 0, 0);

      await prisma.scheduledTransactionLog.create({
        data: {
          scheduledTransactionId: bill.id,
          dueDate,
          status: "SNOOZED",
          actionDate: new Date(),
          snoozeUntil,
        },
      });

      return NextResponse.json({ message: `Bill snoozed for ${days} day${days > 1 ? "s" : ""}` });
    }

    if (action === "skip") {
      // Log the skip
      await prisma.scheduledTransactionLog.create({
        data: {
          scheduledTransactionId: bill.id,
          dueDate,
          status: "SKIPPED",
          actionDate: new Date(),
        },
      });

      // Advance nextDueDate to next occurrence
      const nextDue = computeNextDueDate(dueDate, bill.frequency, originalStartDay, bill.customIntervalDays);

      const shouldDeactivate = bill.endDate && nextDue > bill.endDate;

      await prisma.scheduledTransaction.update({
        where: { id },
        data: {
          nextDueDate: nextDue,
          ...(shouldDeactivate && { isActive: false }),
        },
      });

      return NextResponse.json({ message: "Bill skipped" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to process action" }, { status: 500 });
  }
}
