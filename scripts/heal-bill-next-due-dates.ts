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
 * Usage:
 *   pnpm tsx scripts/heal-bill-next-due-dates.ts          # dry run (default)
 *   pnpm tsx scripts/heal-bill-next-due-dates.ts --apply  # actually update
 */
import { PrismaClient } from "@prisma/client";
import { advanceToNextUnpaidOccurrence } from "../src/lib/bill-utils";

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
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
