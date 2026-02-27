import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { computeNextDueDate } from "@/lib/bill-utils";
import type { PendingReminder, ScheduledTransactionWithCategory } from "@/types";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find active bills where nextDueDate - reminderDaysBefore <= today
  const bills = await prisma.scheduledTransaction.findMany({
    where: {
      userId,
      isActive: true,
    },
    include: { category: true },
  });

  const reminders: PendingReminder[] = [];

  for (const bill of bills) {
    const reminderDate = new Date(bill.nextDueDate);
    reminderDate.setDate(reminderDate.getDate() - bill.reminderDaysBefore);
    reminderDate.setHours(0, 0, 0, 0);

    // Not yet time to remind
    if (reminderDate > today) continue;

    const dueDate = new Date(bill.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);

    // Check if this occurrence already has a log entry (PAID or SKIPPED)
    const existingLog = await prisma.scheduledTransactionLog.findFirst({
      where: {
        scheduledTransactionId: bill.id,
        dueDate: bill.nextDueDate,
        status: { in: ["PAID", "SKIPPED"] },
      },
    });

    if (existingLog) continue;

    // Check if snoozed and snooze period hasn't expired
    const snoozeLog = await prisma.scheduledTransactionLog.findFirst({
      where: {
        scheduledTransactionId: bill.id,
        dueDate: bill.nextDueDate,
        status: "SNOOZED",
      },
      orderBy: { createdAt: "desc" },
    });

    if (snoozeLog?.snoozeUntil && snoozeLog.snoozeUntil > new Date()) continue;

    const daysPastDue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    reminders.push({
      scheduledTransaction: bill as ScheduledTransactionWithCategory,
      dueDate: bill.nextDueDate.toISOString(),
      isOverdue: daysPastDue > 0,
      daysPastDue: Math.max(0, daysPastDue),
    });

    // If overdue, also check for missed occurrences by iterating forward
    if (daysPastDue > 0) {
      let checkDate = computeNextDueDate(
        bill.nextDueDate,
        bill.frequency,
        bill.startDate.getDate(),
        bill.customIntervalDays,
      );

      // Generate up to 10 missed occurrences
      let missedCount = 0;
      while (checkDate <= today && missedCount < 10) {
        const missedLog = await prisma.scheduledTransactionLog.findFirst({
          where: {
            scheduledTransactionId: bill.id,
            dueDate: checkDate,
            status: { in: ["PAID", "SKIPPED"] },
          },
        });

        if (!missedLog) {
          const missedDaysPast = Math.floor((today.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24));
          reminders.push({
            scheduledTransaction: bill as ScheduledTransactionWithCategory,
            dueDate: checkDate.toISOString(),
            isOverdue: missedDaysPast > 0,
            daysPastDue: Math.max(0, missedDaysPast),
          });
        }

        checkDate = computeNextDueDate(
          checkDate,
          bill.frequency,
          bill.startDate.getDate(),
          bill.customIntervalDays,
        );
        missedCount++;
      }
    }
  }

  // Sort: overdue first (oldest), then due today, then upcoming
  reminders.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    if (a.isOverdue && b.isOverdue) return b.daysPastDue - a.daysPastDue;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  return NextResponse.json(reminders);
}
