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
import type { computeNextDueDate } from "../src/lib/bill-utils";
import { findUnreachableOccurrences, resolveCursor } from "./heal-bill-dates";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");

/** Upper bound on the unreachable-occurrence walk. See the note at its loop. */
const MAX_SCAN_ITERATIONS = 20_000;

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

    // Compared at UTC-day precision; see heal-bill-dates.ts for why never the host's day.
    const { current, resolved, drifted } = resolveCursor(bill, logs);

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

    if (!drifted) continue;

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
  let truncatedBills = 0;

  for (const bill of bills) {
    const logs = await prisma.scheduledTransactionLog.findMany({
      where: { scheduledTransactionId: bill.id, status: { in: ["PAID", "SKIPPED"] } },
      select: { dueDate: true },
    });

    // 20k covers ~55 years of a daily bill. The cap cannot be dropped entirely:
    // computeNextDueDate uses `customIntervalDays ?? 1`, which does not catch a
    // stored 0, so a CUSTOM bill with a zero interval would never advance.
    const { next, missing, truncated, scannedTo } = findUnreachableOccurrences(
      bill,
      logs,
      MAX_SCAN_ITERATIONS,
    );

    const label = bill.description || `(bill ${bill.id})`;

    if (truncated) {
      truncatedBills++;
      console.log(
        `  [truncated] ${label} user=${bill.userId} nextDueDate=${next.toISOString().slice(0, 10)}\n` +
        `      scan stopped at ${scannedTo.toISOString().slice(0, 10)} -- result for this bill is INCOMPLETE`,
      );
    }

    if (missing.length === 0) continue;

    affectedBills++;
    total += missing.length;
    console.log(
      `  [unreachable] ${label} user=${bill.userId} nextDueDate=${next.toISOString().slice(0, 10)}\n` +
      `      ${missing.length} occurrence(s): ${missing.slice(0, 12).join(", ")}` +
      `${missing.length > 12 ? ` ... +${missing.length - 12} more` : ""}`,
    );
  }

  if (affectedBills === 0 && truncatedBills === 0) {
    console.log("  none — every occurrence before nextDueDate has a PAID or SKIPPED log");
  } else if (affectedBills === 0) {
    console.log(
      `\n  No unreachable occurrences found, but ${truncatedBills} bill(s) were only scanned partially.` +
      "\n  This is NOT a clean result — re-check those bills before concluding no backfill is needed.",
    );
  } else {
    console.log(`\n  ${total} unreachable occurrence(s) across ${affectedBills} bill(s). Nothing was changed.`);
    if (truncatedBills > 0) {
      console.log(`  ${truncatedBills} bill(s) were scanned only partially — the real count may be higher.`);
    }
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
