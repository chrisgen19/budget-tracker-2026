import { prisma } from "@/lib/prisma";
import { addUtcDays, computeNextDueDate, utcDayStart } from "@/lib/bill-utils";
import type { PendingReminder, ScheduledTransactionWithCategory } from "@/types";

/**
 * @param timezoneOffset  Minutes from `Date.getTimezoneOffset()`, so "today" is
 *   the user's calendar day rather than the container's. Without it a UTC server
 *   reports the previous day for the first 8 hours of an Asia/Manila day, which
 *   shifts every daysPastDue and flips "Due today" to "Due tomorrow".
 */
export async function getPendingRemindersForUser(
  userId: string,
  timezoneOffset = 0,
): Promise<PendingReminder[]> {
  const tzMs = timezoneOffset * 60 * 1000;
  const localNow = new Date(Date.now() - tzMs);
  const today = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()));

  const bills = await prisma.scheduledTransaction.findMany({
    where: { userId, isActive: true },
    include: { category: true },
  });

  if (bills.length === 0) return [];

  const billIds = bills.map((b) => b.id);

  const allLogs = await prisma.scheduledTransactionLog.findMany({
    where: { scheduledTransactionId: { in: billIds } },
    orderBy: { createdAt: "desc" },
  });

  const logsByBillId = new Map<string, typeof allLogs>();
  for (const log of allLogs) {
    const existing = logsByBillId.get(log.scheduledTransactionId) ?? [];
    existing.push(log);
    logsByBillId.set(log.scheduledTransactionId, existing);
  }

  const reminders: PendingReminder[] = [];

  for (const bill of bills) {
    const reminderDate = utcDayStart(addUtcDays(bill.nextDueDate, -bill.reminderDaysBefore));

    if (reminderDate > today) continue;

    const dueDate = utcDayStart(bill.nextDueDate);

    const billLogs = logsByBillId.get(bill.id) ?? [];
    const dueDateMs = bill.nextDueDate.getTime();

    const hasFinalLog = billLogs.some(
      (log) =>
        log.dueDate.getTime() === dueDateMs &&
        (log.status === "PAID" || log.status === "SKIPPED"),
    );
    if (hasFinalLog) continue;

    const latestSnooze = billLogs.find(
      (log) =>
        log.dueDate.getTime() === dueDateMs && log.status === "SNOOZED",
    );
    if (latestSnooze?.snoozeUntil && latestSnooze.snoozeUntil > new Date()) continue;

    const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    reminders.push({
      scheduledTransaction: bill as ScheduledTransactionWithCategory,
      dueDate: bill.nextDueDate.toISOString(),
      isOverdue: diffDays > 0,
      daysPastDue: Math.max(0, diffDays),
      daysUntilDue: Math.max(0, -diffDays),
    });

    if (diffDays > 0) {
      let checkDate = computeNextDueDate(
        bill.nextDueDate,
        bill.frequency,
        bill.startDate.getUTCDate(),
        bill.customIntervalDays,
      );

      let missedCount = 0;
      while (checkDate <= today && missedCount < 10) {
        const checkMs = checkDate.getTime();

        const missedHasFinal = billLogs.some(
          (log) =>
            log.dueDate.getTime() === checkMs &&
            (log.status === "PAID" || log.status === "SKIPPED"),
        );

        if (!missedHasFinal) {
          const missedDiff = Math.floor((today.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24));
          reminders.push({
            scheduledTransaction: bill as ScheduledTransactionWithCategory,
            dueDate: checkDate.toISOString(),
            isOverdue: missedDiff > 0,
            daysPastDue: Math.max(0, missedDiff),
            daysUntilDue: Math.max(0, -missedDiff),
          });
        }

        checkDate = computeNextDueDate(
          checkDate,
          bill.frequency,
          bill.startDate.getUTCDate(),
          bill.customIntervalDays,
        );
        missedCount++;
      }
    }
  }

  reminders.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    if (a.isOverdue && b.isOverdue) return b.daysPastDue - a.daysPastDue;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  return reminders;
}
