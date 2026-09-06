/**
 * Drives the whole AI Assessment generation against a real database and a real Gemini call.
 *
 * `verify-assessment-facts.ts` proves the *measured* half is right. This proves the written half
 * actually uses it. That gap matters more than it looks: `assessmentReportSchema` defaults every
 * section, so a prompt the model mishandles degrades to empty arrays rather than throwing -- "the
 * model had nothing to say" and "the prompt is broken" produce identical output, and nothing in
 * the unit suite can tell them apart because nothing there calls a model.
 *
 *   pnpm exec tsx --env-file=.env scripts/verify-ai-assessment.ts
 *   BUDGET_USER_ID=<id> FROM=2026-08-01 TO=2026-08-31 pnpm exec tsx --env-file=.env scripts/verify-ai-assessment.ts
 *
 * Read-only, but it spends two Gemini calls per run and counts against nothing -- it writes no
 * `AiUsageLog` row, since it does not go through the route.
 */
import { PrismaClient } from "@prisma/client";
import { collectAssessmentFacts } from "../src/lib/assessment-facts-query";
import { generateAssessment, type AssessmentPayload, type UpcomingBillsContext } from "../src/lib/ai-assessment";
import { getUpcomingBills } from "../src/lib/budget-queries";
import { formatLocalDate } from "../src/lib/validations";
import type { AiAssessmentReport, AssessmentFacts } from "../src/types";

const prisma = new PrismaClient();

const failures: string[] = [];
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? ` -- ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

/** Every free-text field the model wrote, flattened, so a rule can be checked across all of them. */
const allProse = (r: AiAssessmentReport): string[] => [
  r.summary,
  r.scoreCommentary,
  r.outlook,
  ...r.patterns.flatMap((p) => [p.title, p.detail]),
  ...r.trends.flatMap((t) => [t.title, t.detail]),
  ...r.dataQuality.flatMap((d) => [d.title, d.detail, d.fix]),
  ...r.watchList.flatMap((w) => [w.title, w.detail]),
  ...r.cutBack.flatMap((c) => [c.title, c.reason, c.suggestion]),
  ...r.boostSavings.flatMap((t) => [t.title, t.detail]),
  ...r.earnIdeas.flatMap((t) => [t.title, t.detail]),
  ...r.quickActions,
  // The grounded call carries its own "no raw currency" rule and is the section
  // most likely to break it: search results quote rates and peso figures, and the
  // model carries them through. Counting it and not scanning it exempted the one
  // section with an external source of raw amounts.
  ...r.webTips.flatMap((t) => [t.title, t.detail]),
];

/**
 * The rule the report promises: percentages and relative terms, never raw money.
 *
 * Three shapes, because the model is handed bare numbers in the snapshot and told
 * the currency separately -- so the likeliest leak carries no symbol at all.
 * Checking only for a leading `₱` would have passed "electricity hit 14,126 in
 * May" and "about 1,500 PHP", which are the two forms this actually takes.
 *
 * A bare number counts as money when it has a thousands separator or four-plus
 * digits. That deliberately spares percentages, counts and day figures, and it
 * spares years -- "2026" is not a peso amount, and flagging it would train a
 * reader to ignore the check, which is worse than not having one.
 */
const CURRENCY_CODE = "PHP|USD|EUR|GBP|AUD|CAD|SGD|INR|JPY";
const CURRENCY_IN_PROSE = new RegExp(
  [
    // ₱1,200 / PHP 500
    `(?:[₱$€£¥]|\\b(?:${CURRENCY_CODE}))\\s?\\d[\\d,]*(?:\\.\\d+)?`,
    // 1,500 PHP / 1500 pesos
    `\\d[\\d,]*(?:\\.\\d+)?\\s?(?:${CURRENCY_CODE}|pesos?)\\b`,
    // 14,126 — a separated figure is never a count or a percentage
    `\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?\\b(?!\\s?%)`,
    // 14126 — four-plus digits, but not a year
    `\\b(?!(?:19|20)\\d{2}\\b)\\d{4,}(?:\\.\\d+)?\\b(?!\\s?%)`,
  ].join("|"),
  "i",
);

/**
 * The window `/api/analytics` would compare this one against.
 *
 * Derived from `from`/`to`, never from today. Deriving it from the clock meant
 * `FROM=2026-08-01 TO=2026-08-31` run in September compared August against
 * itself: `previousSummary` came back byte-identical to `summary`, and the model
 * was told income and expenses had not moved while the facts digest showed real
 * movement. The script's own documented invocation exercised a payload
 * production cannot produce.
 *
 * Mirrors `analytics/route.ts`: a full calendar month shifts back one month,
 * anything else shifts back by its own length.
 */
const previousPeriod = (from: string, to: string): { from: string; to: string; label: string } => {
  const [fY, fM, fD] = from.split("-").map(Number);
  const [tY, tM, tD] = to.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");

  const lastDayOfFromMonth = new Date(Date.UTC(fY, fM, 0)).getUTCDate();
  if (fD === 1 && fY === tY && fM === tM && tD === lastDayOfFromMonth) {
    const pm = fM === 1 ? 12 : fM - 1;
    const py = fM === 1 ? fY - 1 : fY;
    const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay)}`, label: `${py}-${pad(pm)}` };
  }

  const start = Date.UTC(fY, fM - 1, fD);
  const span = Date.UTC(tY, tM - 1, tD) - start + 86_400_000;
  const prevTo = new Date(start - 86_400_000);
  const prevFrom = new Date(start - span);
  const key = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return { from: key(prevFrom), to: key(prevTo), label: `${key(prevFrom)} – ${key(prevTo)}` };
};

const resolveUser = async () => {
  const id = process.env.BUDGET_USER_ID;
  if (id) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, currency: true, timezoneOffset: true } });
    if (!user) throw new Error(`No user with id ${id}`);
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

/** Real totals for a window, computed the same way the analytics route does. */
const summarize = async (userId: string, from: string, to: string, tzMs: number) => {
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: new Date(new Date(`${from}T00:00:00.000Z`).getTime() + tzMs), lte: new Date(new Date(`${to}T23:59:59.999Z`).getTime() + tzMs) },
    },
    select: { amount: true, type: true, date: true, category: { select: { name: true } } },
  });
  const income = rows.filter((r) => r.type === "INCOME").reduce((s, r) => s + r.amount, 0);
  const expenses = rows.filter((r) => r.type === "EXPENSE").reduce((s, r) => s + r.amount, 0);
  return { rows, summary: { totalIncome: income, totalExpenses: expenses, netCashFlow: income - expenses, transactionCount: rows.length } };
};

async function main() {
  const user = await resolveUser();
  const tzMs = user.timezoneOffset * 60_000;
  const today = formatLocalDate(new Date(), user.timezoneOffset);
  const [y, m] = today.split("-").map(Number);
  const currentMonthLastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = process.env.FROM ?? `${y}-${String(m).padStart(2, "0")}-01`;
  const to = process.env.TO ?? `${y}-${String(m).padStart(2, "0")}-${String(currentMonthLastDay).padStart(2, "0")}`;
  const previous = previousPeriod(from, to);

  console.log(`user:   ${user.email}`);
  console.log(`period: ${from} .. ${to}  (today ${today})`);
  console.log(`vs:     ${previous.from} .. ${previous.to}\n`);

  const current = await summarize(user.id, from, to, tzMs);
  const prior = await summarize(user.id, previous.from, previous.to, tzMs);

  const byCategory = new Map<string, { amount: number; count: number; type: "INCOME" | "EXPENSE" }>();
  for (const r of current.rows) {
    const key = `${r.category.name}:${r.type}`;
    const g = byCategory.get(key) ?? { amount: 0, count: 0, type: r.type as "INCOME" | "EXPENSE" };
    g.amount += r.amount;
    g.count += 1;
    byCategory.set(key, g);
  }
  const total = current.summary.totalIncome + current.summary.totalExpenses;
  const categoryBreakdown = [...byCategory.entries()]
    .map(([key, g]) => ({ name: key.split(":")[0], type: g.type, amount: g.amount, percentage: total > 0 ? Math.round((g.amount / total) * 100) : 0, transactionCount: g.count }))
    .sort((a, b) => b.amount - a.amount);

  const savingsRate = current.summary.totalIncome > 0 ? current.summary.netCashFlow / current.summary.totalIncome : null;
  const activeDays = new Set(current.rows.map((r) => formatLocalDate(r.date, user.timezoneOffset))).size;
  const expenseRows = current.rows.filter((r) => r.type === "EXPENSE");
  // Days in the assessed range, not days in the current month, and not the days
  // that happen to carry a row. `/api/analytics` divides by this for
  // `avgDailySpend`, and the prompt asks the model to reason from "the current
  // run rate" -- dividing by active days instead handed it a figure ~2.5x the
  // real one for anyone who logs on half the days, so the `outlook` section under
  // test was generated from a number the app never produces.
  const totalDaysInPeriod =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

  // The sub-scores are computed inside the analytics route and are not exported, so these are
  // stand-ins. They are labelled as such here because nothing in the new sections reads them --
  // what is under test is whether the model uses the *facts*, and those are real.
  const sub = { score: 70, label: "Fair", trend: "stable" };
  const payload: AssessmentPayload = {
    currency: user.currency,
    granularity: "monthly",
    periodLabel: `${from} – ${to}`,
    previousPeriodLabel: previous.label,
    summary: current.summary,
    previousSummary: prior.summary,
    healthScore: {
      overallScore: 70,
      overallLabel: "Fair",
      overallTrend: "stable",
      savingsRate,
      subScores: { savingsRate: sub, expenseTrend: sub, incomeStability: sub, diversification: sub, consistency: sub },
    },
    categoryBreakdown,
    statistics: {
      avgDailySpend: totalDaysInPeriod > 0 ? current.summary.totalExpenses / totalDaysInPeriod : null,
      avgExpenseSize: expenseRows.length > 0 ? current.summary.totalExpenses / expenseRows.length : null,
      spendingStreak: 0,
      activeDays,
      totalDaysInPeriod,
      totalTransactions: current.summary.transactionCount,
      categoriesUsed: byCategory.size,
      mostUsedCategory: null,
      mostExpensiveCategory: null,
    },
  };

  const facts: AssessmentFacts = await collectAssessmentFacts(prisma, user.id, { from, to, granularity: "monthly", periodLabel: payload.periodLabel });
  const upcoming = await getUpcomingBills(prisma, user.id, { days: 14, timezoneOffset: user.timezoneOffset });
  const bills: UpcomingBillsContext = { count: upcoming.count, totalAmount: upcoming.totalAmount, totalIsEstimate: upcoming.totalIsEstimate, bills: upcoming.bills };

  console.log("facts in hand:");
  console.log(`  anomalies ${facts.anomalies.length} · missed bills ${facts.bills.missed.length} · movements ${facts.trends.movements.length}`);
  console.log(`  excluded months ${facts.confidence.excludedMonths.join(", ") || "none"} · duplicates ${facts.hygiene.duplicates.length} · unlabeled ${facts.hygiene.unlabeled.pctOfSpend}%\n`);

  const started = Date.now();
  const { report, model } = await generateAssessment(payload, bills, facts);
  console.log(`generated with ${model} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  console.log("--- report ---");
  console.log(`summary:  ${report.summary}`);
  console.log(`outlook:  ${report.outlook || "(empty)"}`);
  for (const p of report.patterns) console.log(`pattern   [${p.severity}] ${p.title}\n            ${p.detail}`);
  for (const t of report.trends) console.log(`trend     [${t.direction}] ${t.title}\n            ${t.detail}`);
  for (const d of report.dataQuality) console.log(`quality   ${d.title}\n            ${d.detail}\n            fix: ${d.fix}`);
  console.log(`watchList ${report.watchList.length} · cutBack ${report.cutBack.length} · boostSavings ${report.boostSavings.length} · earnIdeas ${report.earnIdeas.length} · quickActions ${report.quickActions.length} · webTips ${report.webTips.length} · sources ${report.sources.length}`);

  console.log("\n--- checks ---");
  check(report.summary.trim().length > 0, "summary is written");
  check(report.outlook.trim().length > 0, "outlook is written", "the section would render blank");
  check(report.patterns.length > 0 || facts.anomalies.length === 0, "patterns present when the facts found anomalies", `${facts.anomalies.length} anomalies, 0 patterns`);
  check(report.trends.length > 0 || facts.trends.movements.length === 0, "trends present when categories moved", `${facts.trends.movements.length} movements, 0 trends`);

  const hygieneFindings =
    facts.hygiene.duplicates.length +
    facts.hygiene.fragmentation.length +
    facts.confidence.excludedMonths.length +
    facts.bills.unlinkedPayments.length +
    // The prompt lists unlabeled spend as a dataQuality candidate and the script
    // prints it, but the gate did not count it -- so an account whose only
    // accuracy problem was a fifth of its spending carrying no label scored zero
    // findings, and an empty `dataQuality` passed.
    (facts.hygiene.unlabeled.pctOfSpend > 0 ? 1 : 0);
  check(report.dataQuality.length > 0 || hygieneFindings === 0, "dataQuality present when the data has problems", `${hygieneFindings} findings, 0 dataQuality items`);

  const leaks = allProse(report).filter((s) => CURRENCY_IN_PROSE.test(s));
  check(leaks.length === 0, "no raw currency amounts in prose", leaks.slice(0, 2).join(" | "));

  // The prompt says to lead with the most consequential finding. When a bill has gone unpaid,
  // that is it -- and a report that never names it has not read the facts it was given.
  if (facts.bills.missed.length > 0) {
    const named = facts.bills.missed[0].description.toLowerCase();
    const prose = allProse(report).join(" ").toLowerCase();
    check(prose.includes(named), `missed bill "${facts.bills.missed[0].description}" is named in the report`);
  }

  // Same for a month the coverage gate dropped: reporting its spending as thrift is the failure
  // the gate exists to prevent, so the report has to name that month.
  //
  // Matched on the month itself, not on words like "gap" or "logging". Those
  // appear in nearly every report -- the dataQuality section is prompted to
  // discuss logging and unlabeled spend -- so the check passed whether or not the
  // excluded month was ever mentioned, which is the opposite of what it claims.
  if (facts.confidence.excludedMonths.length > 0) {
    const prose = allProse(report).join(" ").toLowerCase();
    const named = facts.confidence.excludedMonths.filter((month) => {
      const [yy, mm] = month.split("-").map(Number);
      const full = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toLowerCase();
      return prose.includes(month) || prose.includes(full) || prose.includes(full.slice(0, 3));
    });
    check(
      named.length > 0,
      `an excluded month (${facts.confidence.excludedMonths.join(", ")}) is named in the report`,
      "the report never mentions the month whose figures were withheld",
    );
  }

  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed.`);
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
