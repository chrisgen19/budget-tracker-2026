/**
 * The financial assessment report, printed for a human (or a model) to read.
 *
 * This replaces `assess.sql`. The two computed the same nine analyses in two languages, and they
 * had already drifted: the SQL listed ten "new recurring charges" where the app listed none, and
 * scoped the unlinked-payment check to all history where the app scoped it to the window. Same
 * question, two answers, nothing to catch it -- so the report and the app's AI Assessment tab now
 * read one implementation, `src/lib/assessment-facts.ts`.
 *
 *   pnpm exec tsx --env-file=.env scripts/assess.ts
 *   EMAIL=you@example.com MONTHS=12 pnpm exec tsx --env-file=.env scripts/assess.ts
 *
 * Read-only, and it makes no AI call: every figure here is arithmetic over the user's own rows.
 */
import { PrismaClient } from "@prisma/client";
import { collectAssessmentFacts } from "../src/lib/assessment-facts-query";
import { formatLocalDate } from "../src/lib/validations";
import type { AssessmentFacts } from "../src/types";

const prisma = new PrismaClient();

const MONTHS = Number.parseInt(process.env.MONTHS ?? "6", 10);
if (!Number.isFinite(MONTHS) || MONTHS < 1) throw new Error(`MONTHS must be a positive integer, got "${process.env.MONTHS}"`);

const h1 = (title: string) => console.log(`\n=== ${title} ===`);
const h2 = (title: string) => console.log(`\n--- ${title} ---`);
const none = () => console.log("  (none)");

/** Money at whole units with separators: centavo precision is noise at this altitude. */
const money = (n: number | null, currency: string): string =>
  n === null ? "-" : `${currency} ${Math.round(n).toLocaleString("en-US")}`;

/**
 * The user to report on: the named one, else whoever has the most transactions.
 *
 * An address matching nobody raises rather than returning an empty report, which
 * reads exactly like a clean one.
 */
const resolveUser = async () => {
  const email = process.env.EMAIL;
  if (email) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, currency: true, timezoneOffset: true } });
    if (!user) throw new Error(`No user with email ${email}`);
    return user;
  }
  const [busiest] = await prisma.user.findMany({
    select: { id: true, email: true, currency: true, timezoneOffset: true },
    orderBy: { transactions: { _count: "desc" } },
    take: 1,
  });
  if (!busiest) throw new Error("No users in this database");
  return busiest;
};

const printConfidence = (f: AssessmentFacts) => {
  h1("1. DATA CONFIDENCE");
  console.log("    Months below 60% coverage are excluded from every rate, average and trend.");
  console.log("    A month with no rows at all still appears, at 0%.\n");
  console.log("  month     txns  logged  coverage  status");
  for (const m of f.confidence.months) {
    const status = m.status === "ok" ? "ok" : m.status === "partial" ? "PARTIAL - current month" : "EXCLUDED - low coverage";
    console.log(`  ${m.month}  ${String(m.transactionCount).padStart(4)}   ${String(m.daysLogged).padStart(2)}/${m.daysInMonth}    ${String(m.coveragePct).padStart(3)}%    ${status}`);
  }
  h2("gaps of 4+ days with nothing logged");
  if (f.confidence.gaps.length === 0) none();
  for (const g of f.confidence.gaps) console.log(`  ${g.from} -> ${g.to}   ${g.days} days${g.inPeriod ? "  (in the assessed period)" : ""}`);
};

const printHeadline = (f: AssessmentFacts, currency: string) => {
  const hd = f.headline;
  h1("2. HEADLINE (trustworthy months only)");
  console.log(`  months ${hd.months}   income ${money(hd.income, currency)}   expenses ${money(hd.expenses, currency)}   net ${money(hd.net, currency)}`);
  console.log(`  savings rate ${hd.savingsRatePct ?? "-"}%   average monthly burn ${money(hd.avgMonthlyBurn, currency)}`);
  h2("balance and runway");
  console.log(`  running balance ${money(hd.runningBalance, currency)}   months of runway ${hd.monthsOfRunway ?? "-"}`);
};

const printBills = (f: AssessmentFacts, currency: string) => {
  h1("3. BILLS");
  h2("missed: due dates passed with no payment, skip or snooze");
  if (f.bills.missed.length === 0) none();
  for (const b of f.bills.missed) {
    console.log(`  ${b.description}: ${b.missedDueDates.length} unsettled since ${b.missedDueDates[0]} (${b.daysOverdue} days), about ${money(b.estimatedArrears, currency)} to catch up`);
    console.log(`      ${b.missedDueDates.join("  ")}`);
  }

  h2("budgeted vs actually paid  (read swing before variance)");
  for (const b of f.bills.accuracy) {
    console.log(`  ${b.description.padEnd(24)} ${b.verdict.padEnd(15)} budgeted ${money(b.budgeted, currency)}  paid ${money(b.lowest, currency)}..${money(b.highest, currency)}  swing ${b.swing ?? "-"}  variance ${b.variancePct ?? "-"}%  (${b.payments} payments)`);
  }

  const seasonal = f.bills.accuracy.filter((b) => b.verdict === "seasonal");
  if (seasonal.length > 0) {
    h2("bills that genuinely vary: the budget is right for part of the year, so do not 'fix' it");
    for (const b of seasonal) {
      console.log(`  ${b.description} (budgeted ${money(b.budgeted, currency)})`);
      console.log(`      ${b.monthlySeries.map((m) => `${m.label.split(" ")[0]} ${Math.round(m.amount)}`).join("  ")}`);
    }
  }

  h2("paid outside the bill since it was created, so the schedule never advanced (all history)");
  if (f.bills.unlinkedPayments.length === 0) none();
  for (const u of f.bills.unlinkedPayments) {
    console.log(`  ${u.billDescription}: ${u.count} payment(s), ${money(u.total, currency)}, most recent ${u.recentDates.join(", ")}`);
  }
};

const printTrends = (f: AssessmentFacts, currency: string) => {
  h1(`4. CATEGORY TREND (${f.trends.comparedMonthLabel ?? "n/a"} against the trustworthy months before it)`);
  if (f.trends.movements.length === 0) none();
  for (const m of f.trends.movements) {
    console.log(`  ${m.category.padEnd(24)} ${money(m.current, currency).padStart(14)}  vs ${money(m.priorAvg, currency).padStart(14)}  ${m.direction === "new" ? "new" : `${m.changePct}%`}`);
  }
};

const printRecurring = (f: AssessmentFacts, currency: string) => {
  h1("5. RECURRING SPEND");
  const established = f.recurring.items.filter((i) => !i.isNew);
  for (const i of established) {
    console.log(`  ${i.description.padEnd(28)} ${String(i.months).padStart(2)} months  ${String(i.occurrences).padStart(3)}x  avg ${money(i.avgAmount, currency)}  total ${money(i.total, currency)}`);
  }
  if (established.length === 0) none();
  console.log(`\n  About ${money(f.recurring.monthlyBase, currency)} a month repeats${f.recurring.monthlyBasePct !== null ? ` (${f.recurring.monthlyBasePct}% of a typical month)` : ""}.`);

  h2("new recurring charges: first seen in the last 120 days and material");
  console.log("    Immaterial ones are dropped on purpose -- a faithfully repeating bus fare decides nothing.");
  if (f.recurring.newItems.length === 0) none();
  for (const i of f.recurring.newItems) {
    console.log(`  ${i.description.padEnd(28)} ${i.occurrences}x since ${i.firstSeen}  avg ${money(i.avgAmount, currency)}`);
  }
};

const printQuality = (f: AssessmentFacts, currency: string) => {
  h1("6. DATA QUALITY");
  h2("possible duplicates (same day, description and amount)");
  if (f.hygiene.duplicates.length === 0) none();
  for (const d of f.hygiene.duplicates) console.log(`  ${d.date}  ${d.description}  ${money(d.amount, currency)} x${d.copies}${d.inPeriod ? "  (in the assessed period)" : ""}`);

  h2("unlabeled spend, split by cause");
  const u = f.hygiene.unlabeled;
  console.log(`  ${u.pctOfSpend}% of spending carries no label`);
  console.log(`  bill payment (auto-created)  ${String(u.fromBills.count).padStart(4)} txns  ${money(u.fromBills.total, currency)}   <- the app bypasses label auto-apply here, not the user`);
  console.log(`  entered by hand              ${String(u.manual.count).padStart(4)} txns  ${money(u.manual.total, currency)}`);

  h2("same thing stored several ways");
  if (f.hygiene.fragmentation.length === 0) none();
  for (const g of f.hygiene.fragmentation) console.log(`  ${g.transactions} txns: ${g.variants.map((v) => `[${v}]`).join(" ")}`);
};

const printIncome = (f: AssessmentFacts, currency: string) => {
  h1("7. INCOME CONCENTRATION (trustworthy months)");
  if (f.hygiene.incomeSources.length === 0) none();
  for (const s of f.hygiene.incomeSources) {
    console.log(`  ${s.source.padEnd(28)} ${String(s.count).padStart(3)}x  ${money(s.total, currency).padStart(16)}  ${s.pct ?? "-"}%`);
  }
};

const printAnomalies = (f: AssessmentFacts, currency: string) => {
  h1("8. WHAT CHANGED THIS PERIOD");
  console.log("    Measured against the trustworthy months. A month still running is compared");
  console.log("    against the same days of those months, never scaled up.\n");
  if (f.anomalies.length === 0) none();
  for (const a of f.anomalies) {
    const figures = a.current === null ? "" : `  [${money(a.current, currency)}${a.baseline === null ? "" : ` vs ${money(a.baseline, currency)}`}]`;
    console.log(`  [${a.severity}] ${a.kind}: ${a.title}${figures}`);
    console.log(`      ${a.detail}`);
  }
};

async function main() {
  const user = await resolveUser();
  const today = formatLocalDate(new Date(), user.timezoneOffset);
  const [y, m] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  const newest = await prisma.transaction.aggregate({ where: { userId: user.id }, _max: { createdAt: true } });

  const facts = await collectAssessmentFacts(prisma, user.id, {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
    granularity: "monthly",
    periodLabel: `${y}-${mm}`,
    historyMonths: MONTHS,
  });

  h1("WHO / WINDOW");
  console.log(`  ${user.email}   ${user.currency}   offset ${user.timezoneOffset}   today ${today}`);
  console.log(`  window ${facts.window.months} months (${facts.window.from} .. ${facts.window.to})`);
  // A local database is a mirror and drifts the moment the app is used again. A
  // stale snapshot answers "this month" with a confident number that is out of date.
  console.log(`  newest row written ${newest._max.createdAt ? newest._max.createdAt.toISOString().slice(0, 10) : "never"}`);

  printConfidence(facts);
  printHeadline(facts, user.currency);
  printBills(facts, user.currency);
  printTrends(facts, user.currency);
  printRecurring(facts, user.currency);
  printQuality(facts, user.currency);
  printIncome(facts, user.currency);
  printAnomalies(facts, user.currency);
}

/**
 * `main().catch(...).finally(() => prisma.$disconnect())` leaves the promise the
 * `finally` callback returns unawaited, so a disconnect that rejects -- a pooler
 * dropping the connection -- becomes an unhandled rejection with nothing left to
 * catch it. Same shape as `check-migration-drift.ts` and
 * `reconcile-migration-checksums.ts`.
 */
const run = async () => {
  let code = 1;
  try {
    await main();
    code = 0;
  } catch (error) {
    console.error("[assess] failed:", error instanceof Error ? error.message : error);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(code);
};

run();
