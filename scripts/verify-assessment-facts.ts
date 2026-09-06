/**
 * Drives `collectAssessmentFacts` against a real database and prints the report it would send
 * to Gemini and render on the analytics page.
 *
 * Separate from the vitest suite for the reason the other `verify-*` scripts are: those feed the
 * pure functions hand-built rows, so none of them would notice a Prisma `select` that omits a
 * field, a date bound that means something else once Postgres sees it, or a timezone offset
 * applied twice. This runs the real query path against real data.
 *
 *   pnpm exec tsx --env-file=.env scripts/verify-assessment-facts.ts
 *   BUDGET_USER_ID=<id> FROM=2026-08-01 TO=2026-08-31 pnpm exec tsx --env-file=.env scripts/verify-assessment-facts.ts
 *
 * Read-only: it never writes. With no BUDGET_USER_ID it picks whoever has the most transactions,
 * the same default the `finance-assess` skill uses.
 */
import { PrismaClient } from "@prisma/client";
import { collectAssessmentFacts } from "../src/lib/assessment-facts-query";
import { formatLocalDate } from "../src/lib/validations";

const prisma = new PrismaClient();

/** The current month in the user's own calendar — the period the tab opens on. */
const currentMonth = (tzOffset: number): { from: string; to: string } => {
  const local = new Date(Date.now() - tzOffset * 60_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mm = String(m + 1).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
};

const resolveUser = async (): Promise<{ id: string; email: string; timezoneOffset: number }> => {
  if (process.env.BUDGET_USER_ID) {
    const user = await prisma.user.findUnique({
      where: { id: process.env.BUDGET_USER_ID },
      select: { id: true, email: true, timezoneOffset: true },
    });
    // An id matching nobody must fail loudly: every section would otherwise come
    // back empty, and an empty report reads exactly like a clean one.
    if (!user) throw new Error(`No user with id ${process.env.BUDGET_USER_ID}`);
    return user;
  }
  const [busiest] = await prisma.user.findMany({
    select: { id: true, email: true, timezoneOffset: true, _count: { select: { transactions: true } } },
    orderBy: { transactions: { _count: "desc" } },
    take: 1,
  });
  if (!busiest) throw new Error("No users in this database");
  return busiest;
};

async function main() {
  const user = await resolveUser();
  const month = currentMonth(user.timezoneOffset);
  const from = process.env.FROM ?? month.from;
  const to = process.env.TO ?? month.to;

  console.log(`user:   ${user.email} (tz offset ${user.timezoneOffset})`);
  console.log(`today:  ${formatLocalDate(new Date(), user.timezoneOffset)}`);
  console.log(`period: ${from} .. ${to}\n`);

  const started = Date.now();
  const facts = await collectAssessmentFacts(prisma, user.id, {
    from,
    to,
    granularity: "monthly",
    periodLabel: `${from} – ${to}`,
  });
  console.log(`computed in ${Date.now() - started}ms\n`);

  console.log("--- coverage ---");
  for (const m of facts.confidence.months) {
    console.log(`  ${m.month}  ${String(m.coveragePct).padStart(3)}%  ${m.daysLogged}/${m.daysInMonth} days  ${m.transactionCount} txns  ${m.status}`);
  }
  console.log(`  trustworthy: ${facts.confidence.trustworthyMonths.join(", ") || "none"}`);
  console.log(`  excluded:    ${facts.confidence.excludedMonths.join(", ") || "none"}`);

  console.log("\n--- anomalies ---");
  for (const a of facts.anomalies) console.log(`  [${a.severity}] ${a.kind}: ${a.title}\n      ${a.detail}`);
  if (facts.anomalies.length === 0) console.log("  none");

  console.log("\n--- missed bills ---");
  for (const b of facts.bills.missed) {
    console.log(`  ${b.description}: ${b.missedDueDates.length} unsettled since ${b.missedDueDates[0]} (${b.daysOverdue}d)`);
  }
  if (facts.bills.missed.length === 0) console.log("  none");

  console.log("\n--- bill accuracy ---");
  for (const b of facts.bills.accuracy) {
    console.log(`  ${b.description.padEnd(22)} ${b.verdict.padEnd(15)} budgeted ${b.budgeted}  paid ${b.lowest ?? "-"}..${b.highest ?? "-"}  swing ${b.swing ?? "-"}  var ${b.variancePct ?? "-"}%`);
  }

  console.log("\n--- trends ---");
  for (const m of facts.trends.movements.slice(0, 8)) {
    console.log(`  ${m.category.padEnd(22)} ${m.direction.padEnd(5)} ${m.current} vs ${m.priorAvg} (${m.changePct ?? "new"}%)`);
  }

  console.log("\n--- recurring ---");
  console.log(`  monthly base ${facts.recurring.monthlyBase} (${facts.recurring.monthlyBasePct ?? "-"}% of a month)`);
  for (const i of facts.recurring.newItems) console.log(`  NEW  ${i.description} — ${i.avgAmount} × ${i.occurrences} since ${i.firstSeen}`);

  console.log("\n--- data quality ---");
  console.log(`  duplicates: ${facts.hygiene.duplicates.length}`);
  console.log(`  unlabeled:  ${facts.hygiene.unlabeled.pctOfSpend}% of spend (${facts.hygiene.unlabeled.fromBills.count} from bills, ${facts.hygiene.unlabeled.manual.count} manual)`);
  console.log(`  spellings:  ${facts.hygiene.fragmentation.length} groups`);
  console.log(`  income concentration: ${facts.hygiene.incomeConcentrationPct ?? "-"}%`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
