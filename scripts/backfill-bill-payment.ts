/**
 * Record a bill payment that was made but never logged, and settle the
 * occurrence it belongs to.
 *
 * This is the companion to repair-bill-occurrence-links.ts and deliberately
 * separate from it. That script only ever re-points existing rows; this one
 * **creates transactions**, which is a claim about money that no query can
 * verify. Only a person knows whether a skipped month was actually paid, so
 * every entry is named on the command line rather than inferred.
 *
 *   pnpm exec tsx --env-file=.env scripts/backfill-bill-payment.ts \
 *     --email you@example.com \
 *     --bill "DMCI Water" --due 2026-06-08 --amount 1000
 *
 * Repeat --bill/--due/--amount to backfill several at once. Dry run unless
 * --apply is passed.
 *
 * The transaction is dated on the **due date**, since the real payment date is
 * not recoverable; that keeps it in the month it belongs to, which is what
 * every rate and average reads. No labels are applied: a bill's own labels
 * would be right, but these bills carry none, and schedule auto-labelling is
 * wrong by construction for a backdated row -- its premise is a real clock (see
 * `hasTrustworthyTime`), and a payment entered months later has none.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");

const flag = (name: string) => {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1]) out.push(argv[i + 1]);
  });
  return out;
};

const email = flag("email")[0];
const bills = flag("bill");
const dues = flag("due");
const amounts = flag("amount").map(Number);

if (!email || bills.length === 0 || bills.length !== dues.length || bills.length !== amounts.length) {
  console.error("Usage: --email <addr> [--bill <name> --due <YYYY-MM-DD> --amount <n>]...  [--apply]");
  console.error("--bill, --due and --amount must be repeated the same number of times.");
  process.exit(1);
}

const dayStart = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function main() {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, currency: true } });
  if (!user) throw new Error(`No user with email ${email}`);

  const planned: string[] = [];
  const runs: Array<() => Promise<void>> = [];

  // Every log is read during planning and every write deferred, so the same
  // occurrence named twice would enqueue two backfills: two transactions
  // created, the second overwriting the log's transactionId, and the first left
  // counted as spending but attached to nothing.
  const seen = new Set<string>();
  for (let i = 0; i < bills.length; i++) {
    const key = `${bills[i]}|${dues[i]}`;
    if (seen.has(key)) throw new Error(`${bills[i]} ${dues[i]} given more than once`);
    seen.add(key);
  }

  for (let i = 0; i < bills.length; i++) {
    const name = bills[i];
    const due = dayStart(dues[i]);
    const amount = amounts[i];

    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Bad amount for ${name} ${dues[i]}`);

    // findFirst would pick arbitrarily among same-named bills and link real
    // money to the wrong schedule, with nothing in the dry run to show it.
    // Descriptions are not unique, so require exactly one.
    const matches = await prisma.scheduledTransaction.findMany({
      where: { userId: user.id, description: name },
      select: { id: true, description: true, type: true, categoryId: true },
    });
    if (matches.length === 0) throw new Error(`No bill named "${name}" for ${email}`);
    if (matches.length > 1) {
      throw new Error(
        `${matches.length} bills for ${email} are named "${name}" (${matches.map((m) => m.id).join(", ")}) -- ` +
          `rename one, or this cannot tell which schedule the payment belongs to`,
      );
    }
    const bill = matches[0];

    // An occurrence can carry several logs: snoozing writes one and nothing
    // removes it, and `alreadySettled` does not treat SNOOZED as terminal, so a
    // snooze followed by a skip leaves two rows for one due date. An unordered
    // findFirst could take the SNOOZED row, flip it to PAID and leave the skip
    // standing -- two conflicting terminal outcomes for one occurrence.
    const logs = await prisma.scheduledTransactionLog.findMany({
      where: { scheduledTransactionId: bill.id, dueDate: due },
      select: { id: true, status: true, transactionId: true },
    });
    if (logs.length === 0) throw new Error(`${name} has no occurrence due ${dues[i]}`);
    if (logs.some((l) => l.status === "PAID" && l.transactionId)) {
      throw new Error(`${name} ${dues[i]} is already paid and linked -- refusing to double-record`);
    }
    // Only a skip, or a PAID row with nothing attached, is a record this script
    // may settle. A merely snoozed occurrence is still pending and belongs in
    // the app's own Pay flow, which handles labels and the due-date walk.
    const settleable = logs.filter(
      (l) => l.status === "SKIPPED" || (l.status === "PAID" && !l.transactionId),
    );
    if (settleable.length === 0) {
      throw new Error(
        `${name} ${dues[i]} has no skipped occurrence to settle ` +
          `(found: ${logs.map((l) => l.status).join(", ")}) -- pay it in the app instead`,
      );
    }
    if (settleable.length > 1) {
      throw new Error(
        `${name} ${dues[i]} has ${settleable.length} settleable logs (${settleable.map((l) => l.id).join(", ")}) -- ` +
          `resolve them by hand rather than guessing which one this payment settles`,
      );
    }
    const log = settleable[0];

    planned.push(`  ${name.padEnd(24)} ${dues[i]}  create ${amount} and settle (${log.status} -> PAID)`);
    runs.push(async () => {
      await prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({
          data: {
            amount,
            description: bill.description,
            type: bill.type,
            date: due,
            categoryId: bill.categoryId,
            userId: user.id,
            billId: bill.id,
          },
        });
        await tx.scheduledTransactionLog.update({
          where: { id: log.id },
          data: { status: "PAID", transactionId: created.id, actionDate: new Date() },
        });
      });
    });
  }

  console.log(`${APPLY ? "Applying" : "Would apply"} ${planned.length} backfill(s):\n`);
  planned.forEach((p) => console.log(p));

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }
  for (const run of runs) await run();
  console.log(`\nCreated ${runs.length} transaction(s) and settled their occurrences.`);
}

main()
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
