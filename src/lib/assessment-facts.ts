/**
 * The deterministic half of the AI Assessment.
 *
 * The report used to be built from one period's aggregates, computed in the
 * browser and posted to the server. A model handed five totals can only produce
 * coaching that would fit anyone: it cannot see that August is missing eleven
 * days of logging, that Meralco has had no payment recorded since June, or that
 * "subscriptions" has quietly doubled against its own six-month baseline. So it
 * invented patterns instead, which is the one thing a report about money must
 * not do.
 *
 * These functions compute those findings from the database. Every figure here is
 * arithmetic over rows the user actually has; the model's job downstream is to
 * *interpret* them, and the UI renders them beside the prose so a fact never has
 * to be taken on the model's word. The analyses mirror the `finance-assess`
 * skill (#215) so the in-app report and the SQL one cannot disagree.
 *
 * Pure and dependency-injected: the caller loads the rows (see
 * `assessment-facts-query.ts`), which is what makes all of this unit-testable
 * without a database.
 */
import { MONTH_NAMES } from "@/lib/analytics-buckets";
import { computeNextDueDate } from "@/lib/bill-utils";
import { utcDayStart, utcDayKey } from "@/lib/bill-dates";
import { buildEstimateSamples, estimateBillAmount } from "@/lib/bill-estimate";
import type {
  AiWatchSeverity,
  AssessmentAnomaly,
  AssessmentHeadline,
  AssessmentBillAccuracy,
  AssessmentBillFacts,
  AssessmentCategoryMovement,
  AssessmentDataConfidence,
  AssessmentDuplicateGroup,
  AssessmentFacts,
  AssessmentFragmentation,
  AssessmentHygieneFacts,
  AssessmentLoggingGap,
  AssessmentMissedBill,
  AssessmentMonthCoverage,
  AssessmentRecurringFacts,
  AssessmentRecurringItem,
  AssessmentTrendFacts,
  AssessmentUnlinkedBillPayment,
  BillFrequency,
  BillOccurrenceStatus,
  TransactionType,
} from "@/types";

/* ------------------------------------------------------------------ */
/*  Inputs                                                             */
/* ------------------------------------------------------------------ */

/** A transaction as the fact layer sees it: already resolved to the user's calendar day. */
export interface FactTransaction {
  id: string;
  amount: number;
  type: TransactionType;
  /** "YYYY-MM-DD" in the user's own calendar, not UTC's and not the server's. */
  localDate: string;
  description: string;
  categoryId: string;
  categoryName: string;
  billId: string | null;
  labelCount: number;
}

/** A bill plus everything needed to judge it: its schedule, its payments, its settled occurrences. */
export interface FactBill {
  id: string;
  description: string;
  categoryName: string;
  amount: number;
  isVariable: boolean;
  frequency: BillFrequency;
  customIntervalDays: number | null;
  startDate: Date;
  nextDueDate: Date;
  endDate: Date | null;
  payments: Array<{ id: string; date: Date; amount: number }>;
  occurrences: Array<{ dueDate: Date; status: BillOccurrenceStatus; transactionId: string | null; snoozeUntil: Date | null }>;
}

export interface FactsInput {
  currency: string;
  period: { from: string; to: string; label: string; granularity: string };
  /** The user's current calendar day, "YYYY-MM-DD". */
  today: string;
  timezoneOffset: number;
  /** Months of history the trends read, ending with the period's own month. */
  historyMonths: number;
  /** Every transaction in the history window, oldest or newest first — order is not assumed. */
  transactions: FactTransaction[];
  /** Every active bill. Payment history is read in full, not clipped to the window. */
  bills: FactBill[];
  /** Earliest sighting of each folded expense description across the user's whole history. */
  historyFirstSeen?: ReadonlyMap<string, string>;
  /**
   * Every income and expense the user has ever recorded, for the running balance.
   *
   * A balance is not a window: six months of it is a period's net, which is a
   * different number answering a different question.
   */
  allTimeTotals?: { income: number; expenses: number };
  /**
   * Expenses named after a bill but carrying no `billId`, across all history.
   *
   * Passed in rather than filtered out of `transactions`, because the window
   * would clip the finding: a payment made outside the bill system before the
   * window still left that schedule wrong.
   */
  unlinkedCandidates?: FactTransaction[];
}

/* ------------------------------------------------------------------ */
/*  Thresholds                                                         */
/*                                                                     */
/*  Named rather than inlined: each one is a judgement about what is    */
/*  worth telling someone, and a magic number in a condition hides that.*/
/* ------------------------------------------------------------------ */

/** Below this share of a month's days logged, the month is a gap and not a result. */
export const MIN_COVERAGE_PCT = 60;
/** A stretch this long with nothing logged is reported as a gap. */
const MIN_GAP_DAYS = 4;
/** Charged in at least this many distinct months to count as recurring. */
const RECURRING_MIN_MONTHS = 4;
/** First seen inside this many days makes a recurring charge a *new* habit. */
const NEW_RECURRING_DAYS = 120;
/** …and it has to cost at least this share of a month's spending to be worth reporting. */
const NEW_RECURRING_MIN_SHARE = 0.01;
/** A category has to move this much against its baseline before it is a spike. */
const SPIKE_RATIO = 1.4;
/** …and the increase has to be worth this share of the baseline month's spending. */
const MATERIAL_SHARE = 0.05;
/** A single expense this many times its category's typical size is an outlier. */
const OUTLIER_RATIO = 3;
/** Payments swinging this much mark a metered bill rather than a misconfigured one. */
const SEASONAL_SWING = 2;
/** Average paid this far from budgeted is a figure worth fixing. */
const BILL_VARIANCE_PCT = 15;
/** A projected overshoot below this is inside the noise of a partial month. */
const PACE_OVERSHOOT = 1.15;

/* ------------------------------------------------------------------ */
/*  Calendar-day helpers                                               */
/*                                                                     */
/*  Every day here is a "YYYY-MM-DD" string already resolved to the     */
/*  user's calendar, so the arithmetic is done on UTC-anchored dates:   */
/*  a local getter would shift them a second time.                     */
/* ------------------------------------------------------------------ */

const monthOf = (day: string): string => day.slice(0, 7);

const parseDay = (day: string): Date => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const daysBetween = (from: string, to: string): number =>
  Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);

const daysInMonth = (month: string): number => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const monthLabel = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

/** Every "YYYY-MM" from `from` to `to` inclusive, oldest first. */
export const monthRange = (from: string, to: string): string[] => {
  const months: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return months;
};

/** The month `back` months before `month`. */
export const shiftMonth = (month: string, back: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const round = (n: number): number => Math.round(n * 100) / 100;
const pct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 100);

/**
 * Descriptions are compared folded: "Netflix " and "netflix" are one thing.
 *
 * Exported because the loader keys its whole-history lookup the same way, and two
 * folding rules would silently stop the two maps meeting.
 */
export const foldDescription = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/* ------------------------------------------------------------------ */
/*  1. Data confidence                                                 */
/* ------------------------------------------------------------------ */

/**
 * Per-month coverage across the window.
 *
 * The calendar is generated first and transactions bucketed onto it, so a month
 * with no rows at all still appears at 0% rather than vanishing — which is the
 * most extreme case of exactly the thing this is here to report.
 */
export const computeCoverage = (
  transactions: FactTransaction[],
  months: string[],
  currentMonth: string,
): AssessmentMonthCoverage[] => {
  const byMonth = new Map<string, { days: Set<string>; count: number; income: number; expenses: number }>();
  for (const month of months) byMonth.set(month, { days: new Set(), count: 0, income: 0, expenses: 0 });

  for (const t of transactions) {
    const bucket = byMonth.get(monthOf(t.localDate));
    if (!bucket) continue;
    bucket.days.add(t.localDate);
    bucket.count += 1;
    if (t.type === "INCOME") bucket.income += t.amount;
    else bucket.expenses += t.amount;
  }

  return months.map((month) => {
    const b = byMonth.get(month)!;
    const total = daysInMonth(month);
    const coveragePct = Math.round((b.days.size / total) * 100);
    return {
      month,
      label: monthLabel(month),
      daysLogged: b.days.size,
      daysInMonth: total,
      coveragePct,
      transactionCount: b.count,
      income: round(b.income),
      expenses: round(b.expenses),
      status: month >= currentMonth ? "partial" : coveragePct < MIN_COVERAGE_PCT ? "low-coverage" : "ok",
    };
  });
};

/** Stretches of `MIN_GAP_DAYS`+ days between consecutive logged days, longest first. */
export const findLoggingGaps = (
  transactions: FactTransaction[],
  period: { from: string; to: string },
): AssessmentLoggingGap[] => {
  const days = [...new Set(transactions.map((t) => t.localDate))].sort();
  const gaps: AssessmentLoggingGap[] = [];
  for (let i = 1; i < days.length; i++) {
    const span = daysBetween(days[i - 1], days[i]);
    if (span < MIN_GAP_DAYS) continue;
    gaps.push({
      from: days[i - 1],
      to: days[i],
      days: span,
      // A gap that straddles the period boundary still overlaps it: the period
      // is missing every day of the overlap, which is what makes it in-period.
      inPeriod: days[i - 1] <= period.to && days[i] >= period.from,
    });
  }
  return gaps.sort((a, b) => b.days - a.days).slice(0, 6);
};

/**
 * The coverage gate plus the period's own completeness.
 *
 * `periodDaysElapsed` is what makes a run-rate honest: three days into a month,
 * spending is not "down 90%", it is three days old.
 */
export const computeConfidence = (
  transactions: FactTransaction[],
  months: string[],
  period: { from: string; to: string },
  today: string,
): AssessmentDataConfidence => {
  const coverage = computeCoverage(transactions, months, monthOf(today));
  const inPeriod = transactions.filter((t) => t.localDate >= period.from && t.localDate <= period.to);
  const periodDaysTotal = daysBetween(period.from, period.to) + 1;
  const periodEnd = period.to < today ? period.to : today;
  const periodDaysElapsed = Math.max(0, Math.min(periodDaysTotal, daysBetween(period.from, periodEnd) + 1));
  const loggedInPeriod = new Set(inPeriod.map((t) => t.localDate)).size;

  return {
    months: coverage,
    trustworthyMonths: coverage.filter((m) => m.status === "ok").map((m) => m.month),
    excludedMonths: coverage.filter((m) => m.status === "low-coverage").map((m) => m.month),
    gaps: findLoggingGaps(transactions, period),
    periodCoveragePct: periodDaysElapsed === 0 ? 0 : Math.round((loggedInPeriod / periodDaysElapsed) * 100),
    periodIsPartial: period.to > today,
    periodDaysElapsed,
    periodDaysTotal,
  };
};

/* ------------------------------------------------------------------ */
/*  2. Trends                                                          */
/* ------------------------------------------------------------------ */

/** The day of the month a local calendar day falls on. */
const dayOfMonth = (day: string): number => Number(day.slice(8, 10));

/**
 * Expense totals per category per month, for the given months only.
 *
 * `throughDay` clips every month to the same day-of-month, which is what makes a
 * month still in progress comparable to a complete one. Scaling the partial
 * month up instead would be worse: rent lands on the 1st, so six days into
 * September a linear projection multiplies one rent payment by five.
 */
const spendByCategoryMonth = (
  transactions: FactTransaction[],
  months: Set<string>,
  throughDay = 31,
): Map<string, Map<string, number>> => {
  const byCategory = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.type !== "EXPENSE") continue;
    if (dayOfMonth(t.localDate) > throughDay) continue;
    const month = monthOf(t.localDate);
    if (!months.has(month)) continue;
    const row = byCategory.get(t.categoryName) ?? new Map<string, number>();
    row.set(month, (row.get(month) ?? 0) + t.amount);
    byCategory.set(t.categoryName, row);
  }
  return byCategory;
};

/**
 * How each category moved between the compared month and the months before it.
 *
 * Every category is crossed with every baseline month and the missing
 * combinations filled with zero. Averaging only the months a category *did*
 * appear in measures it against itself: a category seen once at 100 across four
 * months reads as a baseline of 100 rather than 25, so a rise to 200 is reported
 * as +100% when it is really +700%.
 *
 * Ranked by absolute movement, not by percentage. Zero-filling makes an
 * intermittent category read -100% in any month it is skipped, and on a small
 * base that crowds out the movements that actually matter.
 */
export const computeCategoryMovements = (
  transactions: FactTransaction[],
  baselineMonths: string[],
  comparedMonth: string,
): AssessmentCategoryMovement[] => {
  const priorMonths = baselineMonths.filter((m) => m !== comparedMonth);
  const all = new Set([...priorMonths, comparedMonth]);
  const byCategory = spendByCategoryMonth(transactions, all);

  const movements: AssessmentCategoryMovement[] = [];
  for (const [category, months] of byCategory) {
    const current = months.get(comparedMonth) ?? 0;
    if (current === 0 && priorMonths.length === 0) continue;
    const priorAvg = priorMonths.length === 0 ? 0 : sum(priorMonths.map((m) => months.get(m) ?? 0)) / priorMonths.length;
    const isNew = priorAvg === 0 && current > 0;
    movements.push({
      category,
      type: "EXPENSE",
      current: round(current),
      priorAvg: round(priorAvg),
      changePct: isNew ? null : pct(current - priorAvg, priorAvg),
      change: round(current - priorAvg),
      direction: isNew ? "new" : current >= priorAvg ? "up" : "down",
      baselineMonths: priorMonths.length,
    });
  }
  return movements.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 12);
};

/** The month the movements describe: the most recent trustworthy one, else the period's own. */
const pickComparedMonth = (trustworthy: string[], period: { to: string }): string | null =>
  trustworthy.length > 0 ? trustworthy[trustworthy.length - 1] : monthOf(period.to);

export const computeTrends = (
  transactions: FactTransaction[],
  coverage: AssessmentMonthCoverage[],
  trustworthy: string[],
  period: { to: string },
): AssessmentTrendFacts => {
  const comparedMonth = pickComparedMonth(trustworthy, period);
  const trusted = coverage.filter((m) => trustworthy.includes(m.month));
  const income = sum(trusted.map((m) => m.income));
  const expenses = sum(trusted.map((m) => m.expenses));

  return {
    comparedMonth,
    comparedMonthLabel: comparedMonth ? monthLabel(comparedMonth) : null,
    baselineMonths: trustworthy,
    movements: comparedMonth ? computeCategoryMovements(transactions, trustworthy, comparedMonth) : [],
    monthlyNet: trusted.map((m) => ({
      month: m.month,
      label: m.label,
      income: m.income,
      expenses: m.expenses,
      net: round(m.income - m.expenses),
    })),
    baselineSavingsRatePct: pct(income - expenses, income),
    avgMonthlyBurn: trusted.length === 0 ? null : round(expenses / trusted.length),
  };
};

/**
 * The figures that come before the detail.
 *
 * Reads `computeTrends`' output rather than recomputing the same sums from the
 * coverage rows twelve lines away. Two copies of one piece of arithmetic is the
 * drift this whole module exists to remove, and it would be a poor place to
 * reintroduce it.
 *
 * The balance is the exception to the coverage gate: rates and the burn average
 * over trustworthy months so a logging gap cannot flatter them, but what an
 * account holds is not a property of the window being assessed. Unknown is
 * `null`, never zero -- a fabricated balance is the one figure a report about
 * money must not print.
 */
export const computeHeadline = (
  trends: AssessmentTrendFacts,
  allTime: { income: number; expenses: number } | null,
): AssessmentHeadline => {
  const income = sum(trends.monthlyNet.map((m) => m.income));
  const expenses = sum(trends.monthlyNet.map((m) => m.expenses));
  const burn = trends.avgMonthlyBurn;
  const runningBalance = allTime === null ? null : round(allTime.income - allTime.expenses);

  return {
    months: trends.monthlyNet.length,
    income: round(income),
    expenses: round(expenses),
    net: round(income - expenses),
    savingsRatePct: trends.baselineSavingsRatePct,
    avgMonthlyBurn: burn,
    runningBalance,
    // What the balance covers if income stopped -- the ordinary meaning of
    // runway, and why it divides by gross spending rather than by net. A balance
    // already under water has no runway to report, and dividing it yields a
    // negative month count that reads as a figure rather than as a warning.
    monthsOfRunway:
      runningBalance === null || runningBalance <= 0 || burn === null || burn <= 0
        ? null
        : Math.round((runningBalance / burn) * 10) / 10,
  };
};

/* ------------------------------------------------------------------ */
/*  3. Recurring spend                                                 */
/* ------------------------------------------------------------------ */

/**
 * Charges seen in most months of the window — the fixed base under the
 * discretionary spending, and the place a subscription quietly joins.
 *
 * Read across the whole window rather than the trustworthy months only. An
 * excluded month is missing rows, not carrying wrong ones: filtering it would
 * understate recurrence, and a subscription hidden by a logging gap is exactly
 * the one worth surfacing.
 */
export const computeRecurring = (
  transactions: FactTransaction[],
  today: string,
  avgMonthlyBurn: number | null,
  /**
   * Earliest sighting of each folded description across the user's *whole*
   * history, not just the window. Without it every charge older than the window
   * is reported as new, because the window's own first row is all there is to
   * see -- a subscription running for two years looked 120 days old.
   */
  historyFirstSeen: ReadonlyMap<string, string> = new Map(),
): AssessmentRecurringFacts => {
  const groups = new Map<string, { months: Set<string>; amounts: number[]; days: string[]; label: string }>();
  for (const t of transactions) {
    if (t.type !== "EXPENSE") continue;
    const key = foldDescription(t.description);
    if (!key) continue;
    const g = groups.get(key) ?? { months: new Set<string>(), amounts: [], days: [], label: t.description.trim() };
    g.months.add(monthOf(t.localDate));
    g.amounts.push(t.amount);
    g.days.push(t.localDate);
    groups.set(key, g);
  }

  // A charge costing less than this a month is not creep worth reporting. Kept
  // relative rather than a currency figure: the list was otherwise led by bananas
  // and jeepney fares, which repeat faithfully and decide nothing.
  const materialMonthly = avgMonthlyBurn === null ? 0 : avgMonthlyBurn * NEW_RECURRING_MIN_SHARE;

  const items: AssessmentRecurringItem[] = [];
  for (const [key, g] of groups) {
    const days = g.days.sort();
    const firstSeen = historyFirstSeen.get(key) ?? days[0];
    const monthlyCost = sum(g.amounts) / g.months.size;
    const isNew = daysBetween(firstSeen, today) <= NEW_RECURRING_DAYS && monthlyCost >= materialMonthly;
    // Two sightings inside four months is a habit forming; four months is an
    // established one. A new charge should not have to wait a third of a year
    // to be noticed, which is the whole point of watching for creep.
    const established = g.months.size >= RECURRING_MIN_MONTHS;
    if (!established && !(isNew && g.months.size >= 2)) continue;
    items.push({
      description: g.label,
      months: g.months.size,
      occurrences: g.amounts.length,
      avgAmount: round(sum(g.amounts) / g.amounts.length),
      total: round(sum(g.amounts)),
      isNew,
      firstSeen,
      lastSeen: days[days.length - 1],
    });
  }

  items.sort((a, b) => b.total - a.total);
  const established = items.filter((i) => i.months >= RECURRING_MIN_MONTHS);
  const monthlyBase = round(sum(established.map((i) => i.total / i.months)));
  return {
    items: items.slice(0, 15),
    newItems: items.filter((i) => i.isNew).sort((a, b) => b.avgAmount - a.avgAmount).slice(0, 8),
    monthlyBase,
    monthlyBasePct: avgMonthlyBurn ? pct(monthlyBase, avgMonthlyBurn) : null,
  };
};

/* ------------------------------------------------------------------ */
/*  4. Hygiene — the accuracy problems, kept apart from the money ones  */
/* ------------------------------------------------------------------ */

/** Same day, same description, same amount: a double submit far more often than two real purchases. */
export const findDuplicates = (
  transactions: FactTransaction[],
  period: { from: string; to: string },
): AssessmentDuplicateGroup[] => {
  const groups = new Map<string, { rows: FactTransaction[]; label: string }>();
  for (const t of transactions) {
    const key = `${t.localDate}|${foldDescription(t.description)}|${t.amount}`;
    const g = groups.get(key) ?? { rows: [], label: t.description.trim() };
    g.rows.push(t);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.rows.length > 1)
    .map((g) => ({
      date: g.rows[0].localDate,
      description: g.label,
      amount: round(g.rows[0].amount),
      copies: g.rows.length,
      inPeriod: g.rows[0].localDate >= period.from && g.rows[0].localDate <= period.to,
    }))
    .sort((a, b) => (Number(b.inPeriod) - Number(a.inPeriod)) || b.amount - a.amount)
    .slice(0, 8);
};

/**
 * One thing stored several ways.
 *
 * It matters beyond tidiness: the Telegram bot answers "did I pay Meralco this
 * month" with a description search, and a row filed as "MERALCO bill" is
 * invisible to a search for "meralco bill" only in the sense that the *user*
 * cannot predict which spelling to type.
 */
export const findFragmentation = (transactions: FactTransaction[]): AssessmentFragmentation[] => {
  const groups = new Map<string, { variants: Set<string>; count: number }>();
  for (const t of transactions) {
    const key = t.description.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) continue;
    const g = groups.get(key) ?? { variants: new Set<string>(), count: 0 };
    g.variants.add(t.description.trim());
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.variants.size > 1)
    .map(([normalized, g]) => ({ normalized, variants: [...g.variants].slice(0, 5), transactions: g.count }))
    .sort((a, b) => b.transactions - a.transactions)
    .slice(0, 6);
};

/** Unlabeled spend split by cause, plus how concentrated income is. */
export const computeHygiene = (
  transactions: FactTransaction[],
  trustworthy: string[],
  period: { from: string; to: string },
): AssessmentHygieneFacts => {
  const trusted = new Set(trustworthy);
  const scoped = transactions.filter((t) => trusted.has(monthOf(t.localDate)));
  const expenses = scoped.filter((t) => t.type === "EXPENSE");
  const unlabeled = expenses.filter((t) => t.labelCount === 0);
  const fromBills = unlabeled.filter((t) => t.billId !== null);
  const manual = unlabeled.filter((t) => t.billId === null);
  const totalSpend = sum(expenses.map((t) => t.amount));

  const income = scoped.filter((t) => t.type === "INCOME");
  const bySource = new Map<string, { total: number; count: number; label: string }>();
  for (const t of income) {
    const key = foldDescription(t.description) || t.categoryName.toLowerCase();
    const g = bySource.get(key) ?? { total: 0, count: 0, label: t.description.trim() || t.categoryName };
    g.total += t.amount;
    g.count += 1;
    bySource.set(key, g);
  }
  const ranked = [...bySource.values()].sort((a, b) => b.total - a.total);
  const top = ranked[0] ?? null;
  const totalIncome = sum(income.map((t) => t.amount));

  return {
    duplicates: findDuplicates(transactions, period),
    unlabeled: {
      fromBills: { count: fromBills.length, total: round(sum(fromBills.map((t) => t.amount))) },
      manual: { count: manual.length, total: round(sum(manual.map((t) => t.amount))) },
      pctOfSpend: pct(sum(unlabeled.map((t) => t.amount)), totalSpend) ?? 0,
    },
    fragmentation: findFragmentation(transactions),
    incomeConcentrationPct: top ? pct(top.total, totalIncome) : null,
    topIncomeSource: top?.label ?? null,
    incomeSources: ranked.slice(0, 8).map((g) => ({
      source: g.label,
      count: g.count,
      total: round(g.total),
      pct: pct(g.total, totalIncome),
    })),
  };
};

/* ------------------------------------------------------------------ */
/*  5. Bills                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every occurrence of a bill from `from` up to (not including) `through`.
 *
 * Generated rather than read from `scheduled_transaction_logs`, because a log
 * row only exists once the occurrence has been *acted on*. A bill nobody paid
 * has no rows at all, which is precisely the case this has to find.
 */
const occurrencesBetween = (bill: FactBill, from: Date, through: Date, maxIterations = 2000): Date[] => {
  // The day-of-month the schedule means, read in UTC: a local reading of a 31st
  // is a 30th on any host behind Greenwich.
  const startDay = utcDayStart(bill.startDate).getUTCDate();
  const end = bill.endDate ? utcDayStart(bill.endDate) : null;
  const dates: Date[] = [];
  let candidate = utcDayStart(from);
  for (let i = 0; i < maxIterations && candidate < through; i++) {
    if (end && candidate > end) break;
    dates.push(candidate);
    candidate = utcDayStart(computeNextDueDate(candidate, bill.frequency, startDay, bill.customIntervalDays));
  }
  return dates;
};

/** Occurrence days the user has settled — paid, skipped, or deliberately snoozed into the future. */
const settledDays = (bill: FactBill, today: Date): Set<string> => {
  const days = new Set<string>();
  for (const o of bill.occurrences) {
    if (o.status === "PAID" || o.status === "SKIPPED") days.add(utcDayKey(o.dueDate));
    // A snooze is a deferral the user chose, not a miss — until it lapses.
    else if (o.status === "SNOOZED" && o.snoozeUntil && utcDayStart(o.snoozeUntil) > today) days.add(utcDayKey(o.dueDate));
  }
  return days;
};

/**
 * Bill occurrences that came due and were never settled.
 *
 * The walk starts at `nextDueDate`, which is the app's own cursor, and not at
 * the bill's start date. Occurrences *earlier* than the cursor were already
 * passed over — a bill created with a start date months back, or one advanced by
 * an out-of-order action — and reporting them would contradict what the bills
 * page shows while telling the user to chase payments the app never asked for.
 * That drift is real but it is `heal-bill-next-due-dates.ts`'s job, not a
 * report's.
 *
 * "Passed" means the same thing here as everywhere else in the app: strictly
 * before the user's own today, the rule `getUpcomingBills` uses for `isOverdue`.
 * A bill due today is not late.
 */
export const findMissedOccurrences = (
  bill: FactBill,
  today: Date,
  estimate: { amount: number; isEstimate: boolean },
): AssessmentMissedBill | null => {
  const settled = settledDays(bill, today);
  const missed = occurrencesBetween(bill, utcDayStart(bill.nextDueDate), today)
    .filter((d) => !settled.has(utcDayKey(d)))
    .map(utcDayKey);

  if (missed.length === 0) return null;
  return {
    id: bill.id,
    description: bill.description,
    categoryName: bill.categoryName,
    amount: round(estimate.amount),
    isEstimate: estimate.isEstimate,
    missedDueDates: missed,
    daysOverdue: daysBetween(missed[0], utcDayKey(today)),
    estimatedArrears: round(estimate.amount * missed.length),
  };
};

/**
 * What a bill's payments cost, month by month, oldest first.
 *
 * Keyed on the **occurrence's** billing period rather than the day the payment
 * happened, the same rule `buildEstimateSamples` uses: a bill due 1 September and
 * paid 31 August belongs to September, and filing it under August moves the
 * seasonal shape by a month.
 */
const paymentSeries = (bill: FactBill, timezoneOffset: number): AssessmentBillAccuracy["monthlySeries"] => {
  const samples = buildEstimateSamples(bill.payments, bill.occurrences.filter((o) => o.status === "PAID"), timezoneOffset);
  // Summed per period, not listed per payment. A bill settled in two instalments
  // yields two samples for one month, and printing them side by side reads as two
  // months -- "Sep 5990  Sep 4200" -- which is the opposite of what a series
  // showing seasonal shape is for. What the period cost is the sum of what was
  // paid against it.
  const byMonth = new Map<string, number>();
  for (const sample of samples) {
    const month = `${sample.year}-${String(sample.month).padStart(2, "0")}`;
    byMonth.set(month, (byMonth.get(month) ?? 0) + sample.amount);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, label: monthLabel(month), amount: round(amount) }));
};

/** Budgeted against actually paid, with `swing` separating a metered bill from a wrong figure. */
export const assessBillAccuracy = (bill: FactBill, timezoneOffset = 0): AssessmentBillAccuracy => {
  const amounts = bill.payments.map((p) => p.amount);
  const base = {
    id: bill.id,
    description: bill.description,
    categoryName: bill.categoryName,
    budgeted: round(bill.amount),
    isVariable: bill.isVariable,
    payments: amounts.length,
  };
  if (amounts.length === 0) {
    return { ...base, avgPaid: null, lowest: null, highest: null, swing: null, variancePct: null, verdict: "no-payments", monthlySeries: [] };
  }

  const avg = sum(amounts) / amounts.length;
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  const swing = lowest === 0 ? null : Math.round((highest / lowest) * 10) / 10;
  const variancePct = pct(avg - bill.amount, bill.amount);

  // Both conditions are needed. Swing alone would list a bill budgeted at 100
  // and paid 300, 300, 600: that swings 2x, but every payment disagrees with the
  // figure and a better constant plainly exists, so the variance warning stands.
  const seasonal =
    amounts.length >= 3 && swing !== null && swing >= SEASONAL_SWING && bill.amount >= lowest && bill.amount <= highest;

  const verdict: AssessmentBillAccuracy["verdict"] = seasonal
    ? "seasonal"
    : variancePct === null || Math.abs(variancePct) <= BILL_VARIANCE_PCT
      ? "ok"
      : variancePct > 0
        ? "under-budgeted"
        : "over-budgeted";

  return {
    ...base,
    avgPaid: round(avg),
    lowest: round(lowest),
    highest: round(highest),
    swing,
    variancePct,
    verdict,
    // Only where the shape is the finding. For a fixed bill the series is seven
    // copies of one number, which is noise in a payload a model has to read.
    monthlySeries: seasonal ? paymentSeries(bill, timezoneOffset) : [],
  };
};

/**
 * Spending named after a bill but never linked to it, so the schedule never advanced.
 *
 * `candidates` is the user's whole history, not the window. The finding is about
 * the bill being wrong rather than about this period's spending: a payment made
 * outside the bill system before the window still left that schedule stalled, and
 * clipping it to six months hides a defect that has not gone away.
 */
export const findUnlinkedBillPayments = (
  bills: FactBill[],
  candidates: FactTransaction[],
): AssessmentUnlinkedBillPayment[] => {
  const byName = new Map(bills.map((b) => [foldDescription(b.description), b]));
  const hits = new Map<string, { bill: FactBill; rows: FactTransaction[] }>();
  for (const t of candidates) {
    if (t.type !== "EXPENSE" || t.billId !== null) continue;
    const bill = byName.get(foldDescription(t.description));
    if (!bill) continue;
    // A payment made before the bill existed settled no occurrence because there
    // were none: someone logging "Rent" by hand for two years and then creating a
    // Rent bill would otherwise be told, permanently, that two dozen payments
    // skipped a schedule that did not yet exist. The SQL this replaced had the
    // same fault, and the one finding it produced on real data -- a February
    // payment against a bill starting in March -- was exactly this false positive.
    if (t.localDate < utcDayKey(bill.startDate)) continue;
    const g = hits.get(bill.id) ?? { bill, rows: [] };
    g.rows.push(t);
    hits.set(bill.id, g);
  }
  return [...hits.values()]
    .map(({ bill, rows }) => ({
      billId: bill.id,
      billDescription: bill.description,
      count: rows.length,
      total: round(sum(rows.map((r) => r.amount))),
      recentDates: rows.map((r) => r.localDate).sort().reverse().slice(0, 3),
    }))
    .sort((a, b) => b.total - a.total);
};

export const computeBillFacts = (
  bills: FactBill[],
  unlinkedCandidates: FactTransaction[],
  today: string,
  timezoneOffset: number,
): AssessmentBillFacts => {
  const todayDate = parseDay(today);
  const dueSoonCutoff = new Date(todayDate.getTime() + 14 * 86_400_000);

  const missed: AssessmentMissedBill[] = [];
  let dueSoonCount = 0;
  let dueSoonTotal = 0;
  let dueSoonIsEstimate = false;

  for (const bill of bills) {
    const dueDate = utcDayStart(bill.nextDueDate);
    // A variable bill's stored amount is a fallback, never a claim about what is
    // owed: derive the figure the same way `get_upcoming_bills` does, so the
    // assessment and the bills page cannot quote two different numbers.
    const derived = bill.isVariable
      ? estimateBillAmount(
          buildEstimateSamples(bill.payments, bill.occurrences.filter((o) => o.status === "PAID"), timezoneOffset),
          dueDate.getUTCMonth() + 1,
          dueDate.getUTCFullYear(),
          bill.amount,
        )
      : null;
    const estimate = { amount: derived ? derived.amount : bill.amount, isEstimate: derived !== null };

    const miss = findMissedOccurrences(bill, todayDate, estimate);
    if (miss) missed.push(miss);

    if (dueDate >= todayDate && dueDate <= dueSoonCutoff) {
      dueSoonCount += 1;
      dueSoonTotal += estimate.amount;
      dueSoonIsEstimate = dueSoonIsEstimate || estimate.isEstimate;
    }
  }

  return {
    asOf: today,
    missed: missed.sort((a, b) => b.daysOverdue - a.daysOverdue),
    accuracy: bills
      .map((bill) => assessBillAccuracy(bill, timezoneOffset))
      .sort((a, b) => Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0)),
    unlinkedPayments: findUnlinkedBillPayments(bills, unlinkedCandidates),
    dueSoonCount,
    dueSoonTotal: round(dueSoonTotal),
    dueSoonIsEstimate,
  };
};

/* ------------------------------------------------------------------ */
/*  6. Anomalies — the patterns the baseline says should not be there   */
/* ------------------------------------------------------------------ */

interface AnomalyContext {
  period: { from: string; to: string };
  /** The period's calendar month, or null when it spans more than one. */
  periodMonth: string | null;
  periodTx: FactTransaction[];
  windowTx: FactTransaction[];
  confidence: AssessmentDataConfidence;
  bills: AssessmentBillFacts;
  hygiene: AssessmentHygieneFacts;
  /** Trustworthy months excluding the period's own — what "normal" is measured against. */
  baselineMonths: string[];
  /** Average monthly spend across those months, or null when there are none. */
  baselineBurn: number | null;
  /**
   * Day of the month the period has reached, when it is still running.
   *
   * Everything compared against the baseline is clipped to it, so a month six
   * days old is measured against the first six days of the months before it
   * rather than against their totals.
   */
  throughDay: number;
  periodIncome: number;
  periodExpenses: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const anomaly = (
  kind: AssessmentAnomaly["kind"],
  severity: AiWatchSeverity,
  title: string,
  detail: string,
  metrics: { current?: number | null; baseline?: number | null; changePct?: number | null } = {},
): AssessmentAnomaly => ({
  kind,
  title,
  detail,
  severity,
  current: metrics.current ?? null,
  baseline: metrics.baseline ?? null,
  changePct: metrics.changePct ?? null,
});

/** Categories spending materially more than the baseline months, plus categories that are new. */
const detectCategorySpikes = (ctx: AnomalyContext): AssessmentAnomaly[] => {
  if (!ctx.periodMonth || ctx.baselineMonths.length === 0 || !ctx.baselineBurn) return [];
  const months = new Set([...ctx.baselineMonths, ctx.periodMonth]);
  const byCategory = spendByCategoryMonth(ctx.windowTx, months, ctx.throughDay);
  const material = ctx.baselineBurn * MATERIAL_SHARE;
  const out: AssessmentAnomaly[] = [];

  for (const [category, series] of byCategory) {
    const current = series.get(ctx.periodMonth) ?? 0;
    const baseline = sum(ctx.baselineMonths.map((m) => series.get(m) ?? 0)) / ctx.baselineMonths.length;
    if (current - baseline < material) continue;

    // "By this point in the month" whenever the month is still running: saying
    // "so far" of a complete month would be an odd way to describe a total.
    const soFar = ctx.throughDay < 31 ? ` by day ${ctx.throughDay}` : "";
    if (baseline === 0) {
      out.push(anomaly("new-category", "medium", `${category} is new this period`,
        `Nothing was spent on ${category} in the previous ${ctx.baselineMonths.length} months${soFar}, and it is now ${pct(current, ctx.periodExpenses) ?? 0}% of the period's spending.`,
        { current: round(current), baseline: 0 }));
      continue;
    }
    if (current / baseline < SPIKE_RATIO) continue;
    const change = pct(current - baseline, baseline);
    out.push(anomaly("category-spike", change !== null && change >= 100 ? "high" : "medium",
      `${category} is running ${change}% above its usual`,
      `${category} is ${change}% above what the trustworthy months had spent on it${soFar}, and it is ${pct(current, ctx.periodExpenses) ?? 0}% of this period's spending.`,
      { current: round(current), baseline: round(baseline), changePct: change }));
  }
  // Ranked by money moved, so a small category that doubled cannot outrank a
  // large one that rose by a third.
  const moved = (x: AssessmentAnomaly) => (x.current ?? 0) - (x.baseline ?? 0);
  return out.sort((a, b) => moved(b) - moved(a)).slice(0, 4);
};

/**
 * Single expenses far larger than anything the user normally pays for this.
 *
 * Two rules, both learned from the same failure — reporting the rent as a 50x
 * one-off, every month.
 *
 * The comparison set excludes the row being judged **by id**, never by value. A
 * value filter looks equivalent and is not: a category holding six identical
 * 5,000 charges would drop all six while judging any one of them, leaving the
 * odd small charge as the median.
 *
 * And a charge with a history of its own is judged against *that* rather than
 * against its category. A category is often bimodal — Housing holds rent and
 * water refills — and a median cannot describe both, so whichever mode has more
 * rows decides, and the other is reported as an anomaly forever. A charge that
 * has been paid at this figure before is by definition not a one-off, which is
 * the question actually being asked.
 */
/** Prior sightings of the same description needed before they outrank the category. */
const OWN_HISTORY_MIN = 2;
const detectOutlierTransactions = (ctx: AnomalyContext): AssessmentAnomaly[] => {
  const byCategory = new Map<string, FactTransaction[]>();
  for (const t of ctx.windowTx) {
    if (t.type !== "EXPENSE") continue;
    byCategory.set(t.categoryName, [...(byCategory.get(t.categoryName) ?? []), t]);
  }
  const material = ctx.periodExpenses * MATERIAL_SHARE;

  return ctx.periodTx
    .filter((t) => t.type === "EXPENSE" && t.amount >= material)
    .map((t) => {
      const peers = (byCategory.get(t.categoryName) ?? []).filter((other) => other.id !== t.id);
      const ownHistory = peers.filter((other) => foldDescription(other.description) === foldDescription(t.description));
      const basis = ownHistory.length >= OWN_HISTORY_MIN ? ownHistory : peers;
      const typical = median(basis.map((other) => other.amount));
      return { t, typical, ratio: typical === 0 ? 0 : t.amount / typical };
    })
    .filter((x) => x.ratio >= OUTLIER_RATIO)
    .sort((a, b) => b.t.amount - a.t.amount)
    .slice(0, 3)
    .map(({ t, typical, ratio }) =>
      anomaly("outlier-transaction", "medium", `One-off ${t.categoryName} charge on ${t.localDate}`,
        `"${t.description || t.categoryName}" is about ${Math.round(ratio)}x the typical ${t.categoryName} charge and ${pct(t.amount, ctx.periodExpenses) ?? 0}% of the period's spending. Worth confirming it is not a mistyped amount.`,
        { current: round(t.amount), baseline: round(typical), changePct: pct(t.amount - typical, typical) }));
};

/** Overspending, a savings rate falling away from the baseline, missing income, and run-rate. */
const detectCashFlowAnomalies = (ctx: AnomalyContext): AssessmentAnomaly[] => {
  const out: AssessmentAnomaly[] = [];
  const net = ctx.periodIncome - ctx.periodExpenses;

  if (net < 0 && ctx.periodExpenses > 0) {
    out.push(anomaly("overspend", "high", "Spending is ahead of income this period",
      `Expenses are ${pct(ctx.periodExpenses - ctx.periodIncome, Math.max(ctx.periodIncome, 1)) ?? 0}% more than what came in, so the shortfall is coming out of savings.`,
      { current: round(ctx.periodExpenses), baseline: round(ctx.periodIncome) }));
  }

  // Only worth raising when the earlier months actually *had* income to compare
  // against. Passing the coverage gate says a month was logged, not that it
  // earned anything, and the wording asserted the second — a fact the layer had
  // not checked, handed to the model as one it could repeat.
  const earnedBefore = ctx.baselineMonths.filter((m) =>
    (ctx.confidence.months.find((c) => c.month === m)?.income ?? 0) > 0);
  if (ctx.periodIncome === 0 && ctx.periodTx.length > 0 && earnedBefore.length > 0) {
    const all = earnedBefore.length === ctx.baselineMonths.length;
    out.push(anomaly("missing-income", all ? "medium" : "low", "No income logged this period",
      all
        ? `All ${earnedBefore.length} earlier months in the window have income recorded. This is usually an unlogged deposit rather than a month without earnings.`
        : `${earnedBefore.length} of the ${ctx.baselineMonths.length} earlier months in the window have income recorded, so this may be an unlogged deposit — or simply how the pay dates fall.`));
  }

  // Run rate, only for a month still in progress: three days into a month,
  // spending is not "down 90%", it is three days old.
  //
  // Measured against the same days of the baseline months rather than by scaling
  // this one up. Spending is lumpy and front-loaded -- rent and the utilities all
  // land in the first week -- so a linear projection on day six multiplies one
  // rent payment by five and cries wolf every month.
  const { periodIsPartial, periodDaysElapsed, periodDaysTotal } = ctx.confidence;
  if (periodIsPartial && ctx.baselineBurn && ctx.periodMonth && periodDaysElapsed >= 5) {
    const soFarByMonth = ctx.baselineMonths.map((m) =>
      sum(ctx.windowTx.filter((t) => t.type === "EXPENSE" && monthOf(t.localDate) === m && dayOfMonth(t.localDate) <= periodDaysElapsed).map((t) => t.amount)));
    const baselineSoFar = soFarByMonth.length === 0 ? 0 : sum(soFarByMonth) / soFarByMonth.length;
    const ratio = baselineSoFar === 0 ? 0 : ctx.periodExpenses / baselineSoFar;
    if (ratio >= PACE_OVERSHOOT) {
      const ahead = Math.round((ratio - 1) * 100);
      out.push(anomaly("pace", "high", "Ahead of a normal month's pace",
        `${periodDaysElapsed} of ${periodDaysTotal} days in, spending is ${ahead}% above where the trustworthy months stood by this day. At this rate the month lands near the projected figure rather than the usual one.`,
        { current: round(ctx.baselineBurn * ratio), baseline: round(ctx.baselineBurn), changePct: ahead }));
    }
  }
  return out;
};

/** Findings about the data itself: missed bills, duplicates, days with nothing logged. */
const detectHygieneAnomalies = (ctx: AnomalyContext): AssessmentAnomaly[] => {
  const out: AssessmentAnomaly[] = [];
  const missed = ctx.bills.missed;
  if (missed.length > 0) {
    const occurrences = sum(missed.map((b) => b.missedDueDates.length));
    out.push(anomaly("missed-bill", "high",
      `${missed.length} bill${missed.length > 1 ? "s" : ""} with no payment recorded`,
      `${missed.map((b) => b.description).slice(0, 3).join(", ")}${missed.length > 3 ? " and others" : ""} — ${occurrences} due date${occurrences > 1 ? "s" : ""} passed without a payment, skip or snooze. Either the payment was never logged, or the bill really is unpaid.`,
      { current: round(sum(missed.map((b) => b.estimatedArrears))) }));
  }

  const dupes = ctx.hygiene.duplicates.filter((d) => d.inPeriod);
  if (dupes.length > 0) {
    out.push(anomaly("duplicate", "medium", `${dupes.length} possible duplicate entr${dupes.length > 1 ? "ies" : "y"}`,
      `Same day, same description and same amount — usually a double submit. Check ${dupes.slice(0, 2).map((d) => `"${d.description}" on ${d.date}`).join(" and ")}.`,
      { current: round(sum(dupes.map((d) => d.amount * (d.copies - 1)))) }));
  }

  const gaps = ctx.confidence.gaps.filter((g) => g.inPeriod);
  if (gaps.length > 0) {
    const worst = gaps[0];
    out.push(anomaly("logging-gap", ctx.confidence.periodCoveragePct < MIN_COVERAGE_PCT ? "high" : "low",
      `${worst.days} days with nothing logged`,
      `Nothing was recorded between ${worst.from} and ${worst.to}, so this period's totals are a floor rather than the whole picture. Coverage is ${ctx.confidence.periodCoveragePct}% of the days elapsed.`,
      { current: ctx.confidence.periodCoveragePct }));
  }
  return out;
};

const SEVERITY_RANK: Record<AiWatchSeverity, number> = { high: 0, medium: 1, low: 2 };

export const detectAnomalies = (ctx: AnomalyContext): AssessmentAnomaly[] =>
  [
    ...detectHygieneAnomalies(ctx),
    ...detectCashFlowAnomalies(ctx),
    ...detectCategorySpikes(ctx),
    ...detectOutlierTransactions(ctx),
  ].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

/* ------------------------------------------------------------------ */
/*  7. Assembly                                                        */
/* ------------------------------------------------------------------ */

/** Default months of history behind the trends. Six survives a season without burying last month. */
export const DEFAULT_HISTORY_MONTHS = 6;
/** Hard ceiling, so a yearly period cannot turn one report into a two-year scan. */
const MAX_WINDOW_MONTHS = 24;

/**
 * The calendar window a report reads.
 *
 * It ends with the period's own month or the current one, whichever is earlier —
 * a yearly period runs to 31 December, and months that have not happened yet
 * would otherwise be reported at 0% coverage as though logging had stopped.
 */
export const resolveFactsWindow = (
  period: { from: string; to: string },
  today: string,
  historyMonths = DEFAULT_HISTORY_MONTHS,
): { months: string[]; dataFrom: string; dataTo: string } => {
  const endMonth = monthOf(period.to) < monthOf(today) ? monthOf(period.to) : monthOf(today);
  const historyStart = shiftMonth(endMonth, historyMonths - 1);
  // The period can start before the history window (a yearly view), and its own
  // rows are what the anomaly pass reads, so the window widens to hold both.
  const startMonth = monthOf(period.from) < historyStart ? monthOf(period.from) : historyStart;
  const months = monthRange(startMonth, endMonth).slice(-MAX_WINDOW_MONTHS);
  const first = months[0] ?? endMonth;

  return {
    months,
    dataFrom: `${first}-01`,
    dataTo: period.to > `${endMonth}-${String(daysInMonth(endMonth)).padStart(2, "0")}`
      ? period.to
      : `${endMonth}-${String(daysInMonth(endMonth)).padStart(2, "0")}`,
  };
};

/**
 * Everything the assessment knows for certain.
 *
 * The order matters: coverage gates the trends, the trends supply the baseline
 * the anomalies are measured against, and the bills are judged against their own
 * full payment history rather than the window.
 */
export const buildAssessmentFacts = (input: FactsInput): AssessmentFacts => {
  const { period, today, transactions, bills } = input;
  const window = resolveFactsWindow(period, today, input.historyMonths);
  const confidence = computeConfidence(transactions, window.months, period, today);
  const trends = computeTrends(transactions, confidence.months, confidence.trustworthyMonths, period);
  const recurring = computeRecurring(transactions, today, trends.avgMonthlyBurn, input.historyFirstSeen);
  const hygiene = computeHygiene(transactions, confidence.trustworthyMonths, period);
  const headline = computeHeadline(trends, input.allTimeTotals ?? null);
  // Falls back to the window when the caller supplies no wider set, so a test or
  // a caller that has only the window still gets an answer -- a narrower one,
  // never a wrong one.
  const billFacts = computeBillFacts(bills, input.unlinkedCandidates ?? transactions, today, input.timezoneOffset);

  const periodTx = transactions.filter((t) => t.localDate >= period.from && t.localDate <= period.to);
  const periodMonth = monthOf(period.from) === monthOf(period.to) ? monthOf(period.from) : null;
  const baselineMonths = confidence.trustworthyMonths.filter((m) => m !== periodMonth);
  const baselineBurn =
    baselineMonths.length === 0
      ? null
      : round(sum(confidence.months.filter((m) => baselineMonths.includes(m.month)).map((m) => m.expenses)) / baselineMonths.length);

  const anomalies = detectAnomalies({
    period,
    periodMonth,
    // Only clip when the period is a single month still running; a completed one
    // is compared whole, and a multi-month period has no day to clip to.
    throughDay:
      periodMonth !== null && confidence.periodIsPartial ? confidence.periodDaysElapsed : 31,
    periodTx,
    windowTx: transactions,
    confidence,
    bills: billFacts,
    hygiene,
    baselineMonths,
    baselineBurn,
    periodIncome: round(sum(periodTx.filter((t) => t.type === "INCOME").map((t) => t.amount))),
    periodExpenses: round(sum(periodTx.filter((t) => t.type === "EXPENSE").map((t) => t.amount))),
  });

  return {
    generatedAt: new Date().toISOString(),
    currency: input.currency,
    period: { ...period },
    window: { from: window.dataFrom, to: window.dataTo, months: window.months.length },
    confidence,
    headline,
    bills: billFacts,
    trends,
    recurring,
    hygiene,
    anomalies,
  };
};
