/**
 * Heal script for bills whose `nextDueDate` is out of sync with their payment
 * history — a consequence of the PUT /api/bills/[id] reset bug (issue #60)
 * and any earlier non-atomic pay/skip/pay_existing writes that left logs
 * orphaned from the bill row.
 *
 * For each active bill, this walks `nextDueDate` forward past any
 * PAID/SKIPPED log until it reaches an unpaid occurrence (or `endDate`).
 * It's safe to run repeatedly — bills that are already correct are skipped.
 *
 * It also reports the opposite kind of drift: occurrences *earlier* than
 * nextDueDate that carry no terminal log. Those were skipped over by an
 * out-of-order pay/skip (fixed in the action route) and are unreachable, since
 * getPendingRemindersForUser only walks forward from nextDueDate. That pass is
 * always read-only, even with --apply -- see the note above reportUnreachable.
 *
 * Usage:
 *   pnpm tsx scripts/heal-bill-next-due-dates.ts          # dry run (default)
 *   pnpm tsx scripts/heal-bill-next-due-dates.ts --apply  # actually update
 */
import { PrismaClient } from "@prisma/client";
import { advanceToNextUnpaidOccurrence, computeNextDueDate } from "../src/lib/bill-utils";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");

async function main() {
  console.log(`[heal-bill-next-due-dates] mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const bills = await prisma.scheduledTransaction.findMany({
    where: { isActive: true },
    select: {
      id: true,
      userId: true,
      description: true,
      frequency: true,
      customIntervalDays: true,
      startDate: true,
      nextDueDate: true,
      endDate: true,
    },
  });

  console.log(`Found ${bills.length} active bill(s)`);

  let checked = 0;
  let drift = 0;
  let deactivated = 0;

  for (const bill of bills) {
    checked++;

    const logs = await prisma.scheduledTransactionLog.findMany({
      where: {
        scheduledTransactionId: bill.id,
        status: { in: ["PAID", "SKIPPED"] },
      },
      select: { dueDate: true, status: true },
    });

    const resolved = advanceToNextUnpaidOccurrence(
      bill.nextDueDate,
      bill.frequency,
      bill.startDate.getDate(),
      bill.customIntervalDays,
      logs,
      { endDate: bill.endDate },
    );

    // No drift: same date (compared at day precision)
    const current = new Date(bill.nextDueDate);
    current.setHours(0, 0, 0, 0);

    if (resolved === null) {
      // Walked past endDate — deactivate.
      deactivated++;
      const label = bill.description || `(bill ${bill.id})`;
      console.log(
        `  [deactivate] ${label} user=${bill.userId} — next unpaid occurrence is past endDate`,
      );
      if (apply) {
        await prisma.scheduledTransaction.update({
          where: { id: bill.id },
          data: { isActive: false },
        });
      }
      continue;
    }

    if (resolved.getTime() === current.getTime()) continue;

    drift++;
    const label = bill.description || `(bill ${bill.id})`;
    console.log(
      `  [update] ${label} user=${bill.userId} — ${current.toISOString().slice(0, 10)} → ${resolved.toISOString().slice(0, 10)}`,
    );

    if (apply) {
      await prisma.scheduledTransaction.update({
        where: { id: bill.id },
        data: { nextDueDate: resolved },
      });
    }
  }

  console.log(
    `\nSummary: checked=${checked}, drift=${drift}, deactivated=${deactivated}${apply ? "" : " (dry run — nothing written)"}`,
  );

  await reportUnreachable(bills);
}

/**
 * Report occurrences before nextDueDate that have no PAID/SKIPPED log.
 *
 * Deliberately read-only. Rewinding nextDueDate automatically would be wrong:
 * a bill whose startDate long predates its first payment has legitimately
 * unpaid early occurrences, and rewinding would flood the reminder banner with
 * a backlog the user never intended to act on. Which of these to reinstate is
 * a per-bill judgement call.
 */
async function reportUnreachable(
  bills: ReadonlyArray<{
    id: string;
    userId: string;
    description: string | null;
    frequency: Parameters<typeof computeNextDueDate>[1];
    customIntervalDays: number | null;
    startDate: Date;
    nextDueDate: Date;
  }>,
) {
  console.log("\n--- Unreachable occurrences (read-only) ---");

  let affectedBills = 0;
  let total = 0;

  for (const bill of bills) {
    const logs = await prisma.scheduledTransactionLog.findMany({
      where: { scheduledTransactionId: bill.id, status: { in: ["PAID", "SKIPPED"] } },
      select: { dueDate: true },
    });

    const terminal = new Set(
      logs.map((l) => {
        const d = new Date(l.dueDate);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      }),
    );

    const next = new Date(bill.nextDueDate);
    next.setHours(0, 0, 0, 0);

    let cursor = new Date(bill.startDate);
    cursor.setHours(0, 0, 0, 0);

    const missing: string[] = [];
    for (let i = 0; i < 500 && cursor.getTime() < next.getTime(); i++) {
      if (!terminal.has(cursor.getTime())) missing.push(cursor.toISOString().slice(0, 10));
      cursor = computeNextDueDate(cursor, bill.frequency, bill.startDate.getDate(), bill.customIntervalDays);
      cursor.setHours(0, 0, 0, 0);
    }

    if (missing.length === 0) continue;

    affectedBills++;
    total += missing.length;
    const label = bill.description || `(bill ${bill.id})`;
    console.log(
      `  [unreachable] ${label} user=${bill.userId} nextDueDate=${next.toISOString().slice(0, 10)}\n` +
      `      ${missing.length} occurrence(s): ${missing.slice(0, 12).join(", ")}` +
      `${missing.length > 12 ? ` ... +${missing.length - 12} more` : ""}`,
    );
  }

  if (affectedBills === 0) {
    console.log("  none — every occurrence before nextDueDate has a PAID or SKIPPED log");
  } else {
    console.log(`\n  ${total} unreachable occurrence(s) across ${affectedBills} bill(s). Nothing was changed.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
