import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPendingRemindersForUser } from "@/lib/pending-bills";
import { sendBillReminderEmail } from "@/lib/email";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: {
      emailBillReminders: true,
      emailVerified: true,
    },
    select: { id: true, email: true, currency: true, timezoneOffset: true },
  });

  let emailsSent = 0;
  let errors = 0;

  for (const user of users) {
    try {
      // Use the stored offset so "overdue" in the email matches what the user
      // sees in the app, rather than the container's timezone
      const reminders = await getPendingRemindersForUser(user.id, user.timezoneOffset ?? 0);
      if (reminders.length === 0) continue;

      // Filter out reminders that already had an email sent
      const reminderKeys = reminders.map((r) => ({
        scheduledTransactionId: r.scheduledTransaction.id,
        dueDate: new Date(r.dueDate),
      }));

      const existingLogs = await prisma.billEmailLog.findMany({
        where: {
          OR: reminderKeys.map((k) => ({
            scheduledTransactionId: k.scheduledTransactionId,
            dueDate: k.dueDate,
          })),
        },
        select: { scheduledTransactionId: true, dueDate: true },
      });

      const sentSet = new Set(
        existingLogs.map((l) => `${l.scheduledTransactionId}:${l.dueDate.getTime()}`),
      );

      const newReminders = reminders.filter(
        (r) => !sentSet.has(`${r.scheduledTransaction.id}:${new Date(r.dueDate).getTime()}`),
      );

      if (newReminders.length === 0) continue;

      const formatter = new Intl.NumberFormat("en", {
        style: "currency",
        currency: user.currency || "PHP",
        minimumFractionDigits: 2,
      });

      const billItems = newReminders.map((r) => ({
        name: r.scheduledTransaction.description || r.scheduledTransaction.category.name,
        amount: formatter.format(r.scheduledTransaction.amount),
        category: r.scheduledTransaction.category.name,
        dueDate: new Date(r.dueDate).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        isOverdue: r.isOverdue,
        daysUntilDue: r.daysUntilDue,
        daysPastDue: r.daysPastDue,
      }));

      // Write log first to prevent duplicate emails if the send succeeds but DB fails after
      const logData = newReminders.map((r) => ({
        scheduledTransactionId: r.scheduledTransaction.id,
        dueDate: new Date(r.dueDate),
      }));

      await prisma.billEmailLog.createMany({ data: logData, skipDuplicates: true });

      try {
        await sendBillReminderEmail(user.email, billItems);
        emailsSent++;
      } catch (sendError) {
        // Email failed — delete logs so reminders are retried next run
        await prisma.billEmailLog.deleteMany({
          where: {
            OR: logData.map((d) => ({
              scheduledTransactionId: d.scheduledTransactionId,
              dueDate: d.dueDate,
            })),
          },
        });
        throw sendError;
      }
    } catch (error) {
      console.error(`[bill-reminders] Failed for user ${user.id}:`, error);
      errors++;
    }
  }

  return NextResponse.json({
    usersProcessed: users.length,
    emailsSent,
    errors,
  });
}
