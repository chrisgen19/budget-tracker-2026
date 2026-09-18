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
import {
  MIN_COVERAGE_PCT,
  daysBetweenCalendarDays as daysBetween,
  daysInCalendarMonth as daysInMonth,
  describeCoverage,
  describePeriodProgress,
  parseCalendarDay as parseDay,
  shiftCalendarDay as addDays,
} from "@/lib/period-progress";
import type {
  AiWatchSeverity,
  AssessmentAnomaly,
  AssessmentAnomalyDrillDown,
  AssessmentAnomalyKind,
  AssessmentAnomalyScope,
  AssessmentHeadline,
  AssessmentBillAccuracy,
  AssessmentBillFacts,
  BudgetPerformanceData,
  AssessmentCategoryMovement,
  AssessmentDataConfidence,
  AssessmentDueSoonBill,
  AssessmentDuplicateGroup,
  AssessmentFacts,
  AssessmentFragmentation,
  AssessmentHygieneFacts,
  AssessmentLoggingGap,
  AssessmentMissedBill,
  AssessmentMonthCoverage,
  AssessmentRecurringFacts,
  AssessmentRecurringItem,
  AssessmentSnoozedBill,
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

export { MIN_COVERAGE_PCT };
/** A stretch this long with nothing logged is reported as a gap. */
const MIN_GAP_DAYS = 4;
/**
 * Charged in at least this many distinct months to count as recurring.
 *
 * Distinct *months*, which is a proxy for "seen often enough to have a cadence" and holds only for
 * a charge that bills monthly or faster. A quarterly charge reaches four distinct months after a
 * year, so it never establishes inside the default six-month window, and an annual one never
 * establishes at all: four of them need four years, and `MAX_WINDOW_MONTHS` caps any scan at two.
 * So lapse, renewal and price findings do not reach slower subscriptions, which is a real gap and
 * not a deliberate exclusion -- closing it means giving the recurring pass a wider window than the
 * facts window, the way `historyFirstSeen` already does for first sightings.
 */
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
/** A recurring charge due inside this many days is worth a heads-up before it lands. */
const RECURRING_RENEWAL_DAYS = 7;
/**
 * Overdue by this many of its own cycles before a recurring charge is called stopped.
 *
 * One whole extra cycle rather than a fixed number of days, so a fortnightly charge four days late
 * is simply late while a monthly one four days late is barely worth the word. The arithmetic scales
 * to any cadence, but `RECURRING_MIN_MONTHS` decides which ones it is ever asked about, and today
 * that is monthly and faster only -- see the note there.
 */
const RECURRING_LAPSE_CYCLES = 1;
/** A recurring charge moving this far from its own average is a price change rather than noise. */
const RECURRING_AMOUNT_CHANGE_PCT = 20;
/**
 * How many charges each recurring question may name at once.
 *
 * The cap belongs on the findings, not on the charges they are looked for in. `recurring.items` is
 * cut to 15 for the payload and ordered by total spend, which ranks a daily coffee above a monthly
 * subscription -- detecting against that list dropped exactly the charges this family exists to
 * catch. Detection reads every established charge instead, and caps what it says about them.
 *
 * Fifteen, not three, and the number is not a taste call: it is the bound that already existed.
 * The loop used to run over `recurring.items`, so a kind could already emit one finding per item in
 * that 15-long list, and a tighter cap here would have *reduced* coverage in the name of fixing it.
 *
 * It has to stay well clear of what a person will realistically resolve, because the cap is applied
 * before suppression, not after: `/api/assessment/facts` loads saved state only for the anomalies
 * that were emitted, and the Watchlist filters resolved and snoozed ones out client-side. So a cap
 * of three, with three resolved, shows an empty group and hides the fourth charge for good. Fifteen
 * does not make that impossible, only remote. The real fix is to cap after suppression, which is a
 * change to where the cap lives for *every* kind in this file -- `bill-snoozed`,
 * `bill-under-budgeted` and the category findings all slice three the same way -- and belongs in
 * its own change rather than in the one that introduced the recurring family.
 *
 * A charge that is merely *new* is exempt and keeps its own smaller cap. Creep is a list worth
 * keeping short; a month with no logging turns every recurring charge at once into "seems to have
 * stopped", and that is the flood this bound is here for.
 */
const RECURRING_FINDINGS_PER_KIND = 15;
/** New charges are creep to skim, not a list to work through. */
const RECURRING_NEW_FINDINGS = 3;
/** Bills falling due inside this many days are a claim on cash worth seeing coming. */
const DUE_SOON_DAYS = 14;
/** ...and inside this many, the reminder stops being informational. */
const DUE_IMMINENT_DAYS = 3;
/**
 * Deferrals of one occurrence before it stops being a deferral and starts being avoidance.
 *
 * Three, not two: snoozing twice is an ordinary week where the money was not there yet, and a
 * finding that fires on it would fire on almost every bill almost every month.
 */
const REPEATED_SNOOZES = 3;

/* ------------------------------------------------------------------ */
/*  Calendar-day helpers                                               */
/*                                                                     */
/*  Every day here is a "YYYY-MM-DD" string already resolved to the     */
/*  user's calendar, so the arithmetic is done on UTC-anchored dates:   */
/*  a local getter would shift them a second time.                     */
/* ------------------------------------------------------------------ */

const monthOf = (day: string): string => day.slice(0, 7);

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

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/**
 * The cadence of a repeating charge, as the median gap between the days it landed on.
 *
 * Median rather than mean because a single missed or double-logged cycle would otherwise move the
 * answer permanently, and cadence is the basis of both "renews soon" and "seems to have stopped" —
 * two claims that a drifting figure would make at the wrong times for months.
 *
 * Days are deduplicated first: two rows on one day are a double submit far more often than a real
 * second charge, and a zero-day gap dragged the median toward nothing.
 */
const chargeIntervalDays = (days: string[]): number | null => {
  const distinct = [...new Set(days)].sort();
  if (distinct.length < 2) return null;
  const gaps = distinct.slice(1).map((day, index) => daysBetween(distinct[index], day));
  const value = Math.round(median(gaps));
  return value > 0 ? value : null;
};

/**
 * Descriptions are compared folded: "Netflix " and "netflix" are one thing, and
 * so are "Yosh\u2019s Salary" and "Yosh's Salary".
 *
 * The apostrophe is folded because iOS substitutes U+2019 as you type, so one
 * source ends up written both ways by the same person on the same phone. Six
 * analyses key on this, and each splits a group it should merge: an income source
 * counted twice, a recurring charge that reaches `RECURRING_MIN_MONTHS` in total
 * and never in either spelling, a double-submit typed once each way. The worst is
 * `findUnlinkedBillPayments`, which matches payments against bill *names* -- there
 * the split is a false negative on a stalled schedule, and silence reads exactly
 * like a clean result.
 *
 * Deliberately narrower than `findFragmentation`, which strips every
 * non-alphanumeric. Folding that far would merge "7:11 Hot Choco" with "711 Hot
 * Choco", changing duplicate and recurrence detection, and would hide those
 * spellings from the one report meant to surface them. An apostrophe is a keyboard
 * artifact; a colon was typed on purpose.
 *
 * Exported because the loader keys its whole-history lookup the same way, and two
 * folding rules would silently stop the two maps meeting.
 */
export const foldDescription = (s: string): string =>
  s.trim().toLowerCase().replace(/[\u2018\u2019\u02BC]/g, "'").replace(/\s+/g, " ");

/**
 * The most selective token of a name, free of whitespace *and* apostrophes.
 *
 * The loader prefilters candidate rows in SQL before `foldDescription` can run,
 * and SQL has no idea what the fold collapses. Searching for the whole name
 * misses "Mirea  Rent" -- two spaces, and two such rows exist in one real
 * account -- because that string does not contain "Mirea Rent". Searching for
 * the longest single token instead is immune to every spacing variant the fold
 * would have normalised, and the fold then narrows the extra rows back out.
 *
 * Apostrophes split a token for exactly the same reason, and it is the half that
 * was missed: a bill named "Angel\u2019s Rent" prefiltered on "Angel\u2019s"
 * discards a payment written "Angel's Rent" in Postgres, so the fold that was
 * added to catch it never sees the row. A pure-matcher test cannot detect that --
 * it is handed a candidate the real query would already have dropped.
 *
 * Longest rather than first because it is the most selective: "Contribution"
 * fetches far fewer rows than "BRV". Splitting costs a little selectivity
 * ("Angel" over "Angel\u2019s"), which is the trade this module already makes
 * everywhere: prefilter wide, narrow with the fold.
 */
export const longestToken = (name: string): string => {
  const tokens = name.split(/[\s'\u2018\u2019\u02BC]+/).filter(Boolean);
  if (tokens.length === 0) return name;
  return tokens.reduce((longest, token) => (token.length > longest.length ? token : longest));
};

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
    const monthCoverage = describeCoverage(b.days, total);
    return {
      month,
      label: monthLabel(month),
      daysLogged: b.days.size,
      daysInMonth: total,
      coveragePct: monthCoverage.percent,
      transactionCount: b.count,
      income: round(b.income),
      expenses: round(b.expenses),
      status: month >= currentMonth ? "partial" : monthCoverage.sufficient ? "ok" : "low-coverage",
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
  const progress = describePeriodProgress(period.from, period.to, today);
  const periodCoverage = describeCoverage(
    inPeriod.map((t) => t.localDate),
    progress.daysElapsed,
  );

  return {
    months: coverage,
    trustworthyMonths: coverage.filter((m) => m.status === "ok").map((m) => m.month),
    excludedMonths: coverage.filter((m) => m.status === "low-coverage").map((m) => m.month),
    gaps: findLoggingGaps(transactions, period),
    periodCoveragePct: periodCoverage.percent,
    periodIsPartial: progress.isPartial,
    periodDaysElapsed: progress.daysElapsed,
    periodDaysTotal: progress.daysInPeriod,
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
 * What `computeRecurring` hands back: the payload facts, plus the charges behind them.
 *
 * `items` is capped at 15 and is what ships to the client, the AI prompt and MCP. `allItems` is
 * every established charge and never leaves this module -- `buildAssessmentFacts` destructures it
 * straight into `AnomalyContext`, so widening it costs nothing on the wire.
 */
export type RecurringComputation = AssessmentRecurringFacts & {
  allItems: AssessmentRecurringItem[];
};

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
): RecurringComputation => {
  // Day and amount travel together. They used to be two parallel arrays, one of
  // which was then sorted in place: any figure read by position after that
  // belonged to a different charge than the date beside it.
  const groups = new Map<string, { months: Set<string>; charges: Array<{ day: string; amount: number }>; label: string }>();
  for (const t of transactions) {
    if (t.type !== "EXPENSE") continue;
    const key = foldDescription(t.description);
    if (!key) continue;
    const g = groups.get(key) ?? { months: new Set<string>(), charges: [], label: t.description.trim() };
    g.months.add(monthOf(t.localDate));
    g.charges.push({ day: t.localDate, amount: t.amount });
    groups.set(key, g);
  }

  // A charge costing less than this a month is not creep worth reporting. Kept
  // relative rather than a currency figure: the list was otherwise led by bananas
  // and jeepney fares, which repeat faithfully and decide nothing.
  const materialMonthly = avgMonthlyBurn === null ? 0 : avgMonthlyBurn * NEW_RECURRING_MIN_SHARE;

  const items: AssessmentRecurringItem[] = [];
  for (const [key, g] of groups) {
    const charges = [...g.charges].sort((a, b) => a.day.localeCompare(b.day));
    const amounts = charges.map((c) => c.amount);
    const days = charges.map((c) => c.day);
    const firstSeen = historyFirstSeen.get(key) ?? days[0];
    const lastSeen = days[days.length - 1];
    const monthlyCost = sum(amounts) / g.months.size;
    const isNew = daysBetween(firstSeen, today) <= NEW_RECURRING_DAYS && monthlyCost >= materialMonthly;
    // Two sightings inside four months is a habit forming; four months is an
    // established one. A new charge should not have to wait a third of a year
    // to be noticed, which is the whole point of watching for creep.
    const established = g.months.size >= RECURRING_MIN_MONTHS;
    if (!established && !(isNew && g.months.size >= 2)) continue;
    const intervalDays = chargeIntervalDays(days);
    const expectedNextDate = intervalDays === null ? null : addDays(lastSeen, intervalDays);
    // Walk back over the unbroken run at the newest amount. Compared rounded, because that is what
    // `latestAmount` reports and a half-centavo difference is not a price change.
    const latest = round(amounts[amounts.length - 1]);
    let runStart = charges.length - 1;
    while (runStart > 0 && round(charges[runStart - 1].amount) === latest) runStart -= 1;
    items.push({
      description: g.label,
      months: g.months.size,
      occurrences: amounts.length,
      avgAmount: round(sum(amounts) / amounts.length),
      total: round(sum(amounts)),
      isNew,
      firstSeen,
      lastSeen,
      intervalDays,
      expectedNextDate,
      daysOverdue: expectedNextDate === null ? 0 : Math.max(0, daysBetween(expectedNextDate, today)),
      latestAmount: latest,
      priorAvgAmount: amounts.length < 2 ? null : round(sum(amounts.slice(0, -1)) / (amounts.length - 1)),
      latestAmountSince: charges[runStart].day,
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
    allItems: items,
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
      transactionIds: g.rows.map((row) => row.id).sort(),
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

/**
 * Occurrences of one bill that were deferred over and over rather than settled.
 *
 * A snooze is a decision the user made and is not a miss, which is why `settledDays` treats a live
 * one as settled - but the same charge pushed back three times running is a different statement
 * from the same charge pushed back once, and nothing was reading the difference.
 *
 * An occurrence that was eventually paid or skipped is dropped however many times it was deferred
 * first: the question is what is still unresolved, and telling someone they hesitated over a bill
 * they have since paid is noise with a number attached.
 */
const findRepeatedSnoozes = (
  bill: FactBill,
  today: Date,
  estimate: { amount: number; isEstimate: boolean },
): AssessmentSnoozedBill[] => {
  const byDueDate = new Map<string, { deferrals: Set<string>; snoozedUntil: Date | null; resolved: boolean }>();
  for (const occurrence of bill.occurrences) {
    const day = utcDayKey(occurrence.dueDate);
    const entry = byDueDate.get(day) ?? { deferrals: new Set<string>(), snoozedUntil: null, resolved: false };
    if (occurrence.status === "PAID" || occurrence.status === "SKIPPED") entry.resolved = true;
    else if (occurrence.status === "SNOOZED") {
      const until = occurrence.snoozeUntil ? utcDayStart(occurrence.snoozeUntil) : null;
      // Distinct deferral days, not rows. The app's snooze button wrote a bare log row with no
      // replay guard from the first bills release until `settleBill` took over, so a lost-response
      // retry or a double tap left several SNOOZED rows for one decision, and this finding claims
      // to count decisions. `snoozeUntil` separates the two exactly: the guard only lets an
      // occurrence be re-snoozed once the previous deferral has lapsed, so a genuine second
      // decision always lands on a later day while a replay repeats the same one. Compared as a
      // UTC day because the old route stored the raw local instant.
      entry.deferrals.add(until ? utcDayKey(until) : "undated");
      if (until && (!entry.snoozedUntil || until > entry.snoozedUntil)) entry.snoozedUntil = until;
    }
    byDueDate.set(day, entry);
  }

  return [...byDueDate.entries()]
    .filter(([, entry]) => !entry.resolved && entry.deferrals.size >= REPEATED_SNOOZES)
    .map(([dueDate, entry]) => ({
      id: bill.id,
      description: bill.description,
      categoryName: bill.categoryName,
      dueDate,
      snoozes: entry.deferrals.size,
      // Only a deferral still running is reported as one. A lapsed `snoozeUntil` is a date in the
      // past, and printing it beside "snoozed until" would read as a deferral that is still in force.
      snoozedUntil: entry.snoozedUntil && entry.snoozedUntil > today ? utcDayKey(entry.snoozedUntil) : null,
      amount: round(estimate.amount),
      isEstimate: estimate.isEstimate,
    }));
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
  const dueSoon: AssessmentDueSoonBill[] = [];
  const repeatedlySnoozed: AssessmentSnoozedBill[] = [];
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
      dueSoon.push({
        id: bill.id,
        description: bill.description,
        categoryName: bill.categoryName,
        dueDate: utcDayKey(dueDate),
        daysUntilDue: daysBetween(today, utcDayKey(dueDate)),
        amount: round(estimate.amount),
        isEstimate: estimate.isEstimate,
      });
      dueSoonTotal += estimate.amount;
      dueSoonIsEstimate = dueSoonIsEstimate || estimate.isEstimate;
    }

    repeatedlySnoozed.push(...findRepeatedSnoozes(bill, todayDate, estimate));
  }

  return {
    asOf: today,
    missed: missed.sort((a, b) => b.daysOverdue - a.daysOverdue),
    accuracy: bills
      .map((bill) => assessBillAccuracy(bill, timezoneOffset))
      .sort((a, b) => Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0)),
    unlinkedPayments: findUnlinkedBillPayments(bills, unlinkedCandidates),
    // Tie-broken on id, not left to the sort's stability. `sort` is stable, so bills falling due
    // on the same day keep the order the loader handed them over in -- and that query has no
    // `orderBy` (`assessment-facts-query.ts`), so Postgres is free to return them differently on
    // the next request. Several bills on the 1st or the 15th is ordinary, and `nextDueDate` is
    // rewritten on every settle, which moves rows. Without this the rendered list reorders itself
    // between refreshes and the finding's identity moves with it.
    dueSoon: dueSoon.sort((a, b) => a.daysUntilDue - b.daysUntilDue || a.id.localeCompare(b.id)),
    dueSoonCount: dueSoon.length,
    dueSoonTotal: round(dueSoonTotal),
    dueSoonIsEstimate,
    repeatedlySnoozed: repeatedlySnoozed.sort((a, b) => b.snoozes - a.snoozes),
  };
};

/* ------------------------------------------------------------------ */
/*  6. Anomalies — the patterns the baseline says should not be there   */
/* ------------------------------------------------------------------ */

interface AnomalyContext {
  period: { from: string; to: string };
  /**
   * The user's own calendar day.
   *
   * Outstanding findings are measured against it rather than against the period, which is the
   * whole of what makes them outstanding: a subscription renewing on Friday does not renew
   * differently because a 2019 report is open.
   */
  today: string;
  /** The period's calendar month, or null when it spans more than one. */
  periodMonth: string | null;
  periodTx: FactTransaction[];
  windowTx: FactTransaction[];
  confidence: AssessmentDataConfidence;
  bills: AssessmentBillFacts;
  recurring: AssessmentRecurringFacts;
  /**
   * Every established recurring charge, uncapped.
   *
   * `recurring.items` is the presentation cut: 15 rows ordered by total spend. Detection has to
   * read the whole set, or a charge ranked 16th by total is never asked whether it has stopped,
   * renewed or changed price -- and total spend ranks a daily coffee above a monthly subscription.
   */
  recurringAll: AssessmentRecurringItem[];
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

/**
 * Whether the selected period bounds each kind of finding.
 *
 * A `Record` over the kinds rather than an argument to `anomaly()` with a default: adding a kind
 * to `AssessmentAnomalyKind` without deciding its scope will not compile, where a default would
 * quietly label the next standing condition as belonging to whatever period is on screen. That is
 * the mistake #340 fixed, and the map is here so it cannot be made a second time.
 *
 * `missed-bill` was once the only outstanding kind; the recurring-charge and bill-behaviour
 * families join it here. Every other producer either filters on `inPeriod` (`duplicate`,
 * `logging-gap`) or measures the period against baseline months, while bills and repeating charges
 * are judged against their own full history (see `buildAssessmentFacts`).
 *
 * An outstanding kind is grouped apart in the Watchlist and left out of the AI tab's "What changed
 * this period" card entirely, so it needs a home of its own on that tab or it will not appear on
 * it at all. `MissedBillsCard` is that home for `missed-bill`; `OutstandingCard` holds the rest.
 */
const ANOMALY_SCOPE: Record<AssessmentAnomalyKind, AssessmentAnomalyScope> = {
  "budget-threshold": "period",
  "budget-forecast": "period",
  "category-spike": "period",
  "new-category": "period",
  "outlier-transaction": "period",
  overspend: "period",
  "savings-drop": "period",
  pace: "period",
  "missing-income": "period",
  duplicate: "period",
  "logging-gap": "period",
  "missed-bill": "outstanding",
  // Recurring charges are judged against their own history and against today's date, never
  // against the selected window: a subscription that renews on Friday renews on Friday whether
  // the report on screen is this month's or one from 2019.
  "recurring-new": "outstanding",
  "recurring-ended": "outstanding",
  "recurring-amount-change": "outstanding",
  "recurring-renews-soon": "outstanding",
  // Bills are judged against their own schedule and payment history, as `missed-bill` already was.
  // A bill due on Friday is due on Friday whichever report is open, and a budgeted figure that has
  // been wrong for a year is not wrong *in September*.
  "bill-due-soon": "outstanding",
  "bill-snoozed": "outstanding",
  "bill-under-budgeted": "outstanding",
};

const anomaly = (
  kind: AssessmentAnomaly["kind"],
  severity: AiWatchSeverity,
  title: string,
  detail: string,
  metrics: {
    current?: number | null;
    baseline?: number | null;
    changePct?: number | null;
    drillDown?: AssessmentAnomalyDrillDown;
    findingKeyEvidence?: string;
    stateKey?: string;
  } = {},
): AssessmentAnomaly => ({
  kind,
  scope: ANOMALY_SCOPE[kind],
  title,
  detail,
  severity,
  current: metrics.current ?? null,
  baseline: metrics.baseline ?? null,
  changePct: metrics.changePct ?? null,
  drillDown: metrics.drillDown,
  findingKeyEvidence: metrics.findingKeyEvidence,
  stateKey: metrics.stateKey,
});

const periodDrillDown = (
  ctx: AnomalyContext,
  type?: "INCOME" | "EXPENSE",
): AssessmentAnomalyDrillDown => ({
  destination: "transactions",
  type,
  from: ctx.period.from,
  to: ctx.period.to,
});

const budgetMonthEnd = (month: string): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
};

const thresholdSeverity = (threshold: number): AiWatchSeverity =>
  threshold >= 100 ? "high" : threshold >= 80 ? "medium" : "low";
const MIN_BUDGET_FORECAST_DAYS = 5;

/** Budget alerts use the same available/actual/projection figures as Budget Performance. */
export const detectBudgetWatchlistAnomalies = (
  budget: BudgetPerformanceData,
): AssessmentAnomaly[] => {
  const plan = budget.plan;
  if (!plan || budget.progress.daysElapsed === 0) return [];
  const to = budget.progress.effectiveTo ?? budgetMonthEnd(budget.month);
  return budget.allocations.flatMap((allocation) => {
    if (allocation.type !== "EXPENSE" || allocation.kind !== "FLEXIBLE" || allocation.available <= 0) return [];
    const usedPct = (allocation.actual / allocation.available) * 100;
    const reached = [100, 80, 50].find((threshold) => usedPct >= threshold);
    const drillDown = {
      destination: "transactions" as const,
      type: "EXPENSE" as const,
      categoryId: allocation.categoryId,
      from: `${budget.month}-01`,
      to,
    };
    const evidence = JSON.stringify({
      plan: plan.id,
      revision: plan.revision,
      categoryId: allocation.categoryId,
      available: allocation.available,
      actual: allocation.actual,
      projectedActual: allocation.projectedActual,
    });
    const findings: AssessmentAnomaly[] = reached === undefined ? [] : [anomaly(
      "budget-threshold",
      thresholdSeverity(reached),
      `${allocation.categoryName} has reached ${reached}% of its budget`,
      `${Math.floor(usedPct)}% of this month's available budget is logged. Available includes any rollover carried into the month.`,
      { current: allocation.actual, baseline: allocation.available, changePct: usedPct, drillDown, findingKeyEvidence: evidence, stateKey: `budget:${plan.id}:${plan.revision}:${allocation.categoryId}:${reached}` },
    )];
    if (budget.progress.daysElapsed >= MIN_BUDGET_FORECAST_DAYS && allocation.forecastToExceed && allocation.actual <= allocation.available && allocation.projectedActual !== null) {
      findings.push(anomaly(
        "budget-forecast",
        "medium",
        `${allocation.categoryName} is forecast to exceed its budget`,
        `At the current pace, this month's projected spending is above the available budget. ${allocation.projectionBasis}`,
        {
          current: allocation.projectedActual,
          baseline: allocation.available,
          changePct: (allocation.projectedActual / allocation.available) * 100,
          drillDown,
          findingKeyEvidence: evidence,
          stateKey: `budget:${plan.id}:${plan.revision}:${allocation.categoryId}:forecast`,
        },
      ));
    }
    return findings;
  });
};

/** A same-named custom/default category cannot be represented by one ledger filter. */
const categoryDrillDown = (ctx: AnomalyContext, category: string): AssessmentAnomalyDrillDown => {
  const categoryIds = [...new Set(ctx.periodTx
    .filter((transaction) => transaction.categoryName === category)
    .map((transaction) => transaction.categoryId))].sort();
  return {
    ...periodDrillDown(ctx, "EXPENSE"),
    ...(categoryIds.length === 1 ? { categoryId: categoryIds[0] } : {}),
  };
};

const categoryFindingEvidence = (category: string, series: Map<string, number>): string =>
  JSON.stringify({ category, months: [...series.entries()].sort(([a], [b]) => a.localeCompare(b)) });

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
        {
          current: round(current),
          baseline: 0,
          drillDown: categoryDrillDown(ctx, category),
          findingKeyEvidence: categoryFindingEvidence(category, series),
        }));
      continue;
    }
    if (current / baseline < SPIKE_RATIO) continue;
    const change = pct(current - baseline, baseline);
    out.push(anomaly("category-spike", change !== null && change >= 100 ? "high" : "medium",
      `${category} is running ${change}% above its usual`,
      `${category} is ${change}% above what the trustworthy months had spent on it${soFar}, and it is ${pct(current, ctx.periodExpenses) ?? 0}% of this period's spending.`,
      {
        current: round(current),
        baseline: round(baseline),
        changePct: change,
        drillDown: categoryDrillDown(ctx, category),
        findingKeyEvidence: categoryFindingEvidence(category, series),
      }));
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
        {
          current: round(t.amount),
          baseline: round(typical),
          changePct: pct(t.amount - typical, typical),
          drillDown: {
            ...periodDrillDown(ctx, "EXPENSE"),
            categoryId: t.categoryId,
            search: t.description || undefined,
          },
        }));
};

/** Overspending, a savings rate falling away from the baseline, missing income, and run-rate. */
const detectCashFlowAnomalies = (ctx: AnomalyContext): AssessmentAnomaly[] => {
  const out: AssessmentAnomaly[] = [];
  const net = ctx.periodIncome - ctx.periodExpenses;

  if (net < 0 && ctx.periodExpenses > 0) {
    out.push(anomaly("overspend", "high", "Spending is ahead of income this period",
      `Expenses are ${pct(ctx.periodExpenses - ctx.periodIncome, Math.max(ctx.periodIncome, 1)) ?? 0}% more than what came in, so the shortfall is coming out of savings.`,
      { current: round(ctx.periodExpenses), baseline: round(ctx.periodIncome), drillDown: periodDrillDown(ctx) }));
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
        : `${earnedBefore.length} of the ${ctx.baselineMonths.length} earlier months in the window have income recorded, so this may be an unlogged deposit — or simply how the pay dates fall.`,
      { drillDown: periodDrillDown(ctx, "INCOME") }));
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
        {
          current: round(ctx.baselineBurn * ratio),
          baseline: round(ctx.baselineBurn),
          changePct: ahead,
          drillDown: periodDrillDown(ctx, "EXPENSE"),
        }));
    }
  }
  return out;
};

/**
 * What the bills themselves are doing, beyond the occurrences nobody paid.
 *
 * Three questions, all asked of today rather than of the period, which is why all three kinds are
 * `outstanding`. `missed-bill` already covered the fourth; these are the ones that were computed
 * into the facts and then read by nothing.
 *
 * `bill-due-soon` aggregates the way `missed-bill` does, and deliberately: five bills falling due
 * in a fortnight is one trip to /bills, and five rows on the Watchlist for it would bury every
 * other finding under a list the Bills page already shows better. The other two are per bill,
 * because each names a different bill to go and change.
 */
const detectBillAnomalies = (ctx: AnomalyContext): AssessmentAnomaly[] => {
  const out: AssessmentAnomaly[] = [];
  const dueSoon = ctx.bills.dueSoon;

  if (dueSoon.length > 0) {
    const imminent = dueSoon[0].daysUntilDue <= DUE_IMMINENT_DAYS;
    const named = dueSoon.slice(0, 3).map((b) => `${b.description} on ${b.dueDate}`).join(", ");
    out.push(anomaly("bill-due-soon", imminent ? "medium" : "low",
      `${dueSoon.length} bill${dueSoon.length > 1 ? "s" : ""} due in the next ${DUE_SOON_DAYS} days`,
      `${named}${dueSoon.length > 3 ? " and others" : ""}. That is a claim on cash already committed, before anything discretionary this month.${ctx.bills.dueSoonIsEstimate ? " Variable bills are estimated from what they have cost before." : ""}`,
      {
        current: ctx.bills.dueSoonTotal,
        drillDown: { destination: "bills" },
        // The identity is the *set* of bills, so a newly due bill is a new finding rather than one
        // silently covered by a snooze taken over a different bill last week. It has to be a
        // `stateKey` and not the default hash: that hash folds in `current`, which is
        // `dueSoonTotal`, and a variable bill's share of it is re-derived by `estimateBillAmount`
        // on every run. Correcting a typo'd payment or logging an out-of-order one would move the
        // total while the set of bills stood still, re-raising a finding already dealt with --
        // the same hazard `bill-under-budgeted` keys around two blocks below.
        // Sorted here as well as in the facts, so the identity is the set itself and not the
        // order something happens to present it in. Belt and braces on purpose: a future change to
        // how the list is ordered for display must not silently reissue every stored dismissal.
        stateKey: `bill:due-soon:${dueSoon.map((b) => `${b.id}@${b.dueDate}`).sort().join(",")}`,
        findingKeyEvidence: JSON.stringify(dueSoon.map((b) => [b.id, b.dueDate])),
      }));
  }

  for (const snoozed of ctx.bills.repeatedlySnoozed.slice(0, 3)) {
    out.push(anomaly("bill-snoozed", "medium",
      `${snoozed.description} has been put off ${snoozed.snoozes} times`,
      `The occurrence due ${snoozed.dueDate} has been snoozed ${snoozed.snoozes} times and is still neither paid nor skipped${snoozed.snoozedUntil ? `, deferred again until ${snoozed.snoozedUntil}` : ""}. If it is not going to be paid, skipping it keeps the schedule honest.`,
      {
        current: snoozed.amount,
        drillDown: { destination: "bills" },
        // The count is part of the identity: a fourth deferral is a fresh decision, not the same
        // finding drifting, so resolving the third must not suppress it.
        stateKey: `bill:snoozed:${snoozed.id}:${snoozed.dueDate}:${snoozed.snoozes}`,
      }));
  }

  const underBudgeted = ctx.bills.accuracy.filter(
    (a) => a.verdict === "under-budgeted" && a.avgPaid !== null && (a.variancePct ?? 0) > 0,
  );
  for (const bill of underBudgeted.slice(0, 3)) {
    out.push(anomaly("bill-under-budgeted", "medium",
      `${bill.description} costs ${bill.variancePct}% more than it is budgeted for`,
      `Across ${bill.payments} payments it has averaged ${bill.variancePct}% above the figure on the bill. Every forecast and every budget that reads this bill is short by that much, every month.`,
      {
        current: bill.avgPaid,
        baseline: bill.budgeted,
        changePct: bill.variancePct,
        drillDown: { destination: "bills" },
        // Keyed on the budgeted figure, which is the thing being asked for: one more payment
        // nudging the average must not re-raise a finding the user has already dealt with, but
        // changing the budget and still being wrong must.
        stateKey: `bill:under-budgeted:${bill.id}:${bill.budgeted}`,
      }));
  }
  return out;
};

/**
 * Changes to the fixed base underneath the discretionary spending.
 *
 * Four questions about a repeating charge, and all four are asked of today rather than of the
 * selected period — which is why every kind here is `outstanding`. A subscription that renews on
 * Friday renews on Friday whichever month's report happens to be open.
 *
 * Only *established* charges are judged for lapse, renewal and price: a charge seen twice has no
 * cadence worth trusting, and reporting that it "seems to have stopped" after one skipped fortnight
 * would be noise. A charge that is new has its own finding, which is the one thing worth saying
 * about a habit that has not settled yet.
 */
const detectRecurringAnomalies = (ctx: AnomalyContext): AssessmentAnomaly[] => {
  const out: AssessmentAnomaly[] = [];
  // Searched on the fold-safe token, not the display spelling. A group is keyed on
  // `foldDescription`, so "Angel\u2019s Rent" and "Angel's Rent" are one charge and the label is
  // whichever of them happened to arrive first -- while the ledger's own search is a plain
  // case-insensitive `contains` that knows nothing about the fold. Linking the label sent a
  // finding that counted four payments to a list showing two. `longestToken` is the same needle
  // `assessment-facts-query` already prefilters bill payments with, and it splits on the
  // apostrophe for exactly this reason. It costs a little selectivity ("Angel" over
  // "Angel\u2019s"); the date range below is what keeps the list narrow.
  const chargeDrillDown = (item: AssessmentRecurringItem): AssessmentAnomalyDrillDown => ({
    destination: "transactions",
    type: "EXPENSE",
    search: item.description ? longestToken(item.description) : undefined,
    from: item.firstSeen,
    to: ctx.today,
  });
  // Identity is the charge, the question asked about it, and *which* occurrence of that question --
  // never the running figures. Without the third part a resolve, which never expires, buried every
  // later answer to the same question: resolving September's renewal meant Netflix never raised a
  // renewal finding again, and resolving a 499 to 699 rise silenced a later 699 to 1299 one.
  //
  // What each kind pins is the thing that stands still for one episode and moves for the next.
  // `expectedNextDate` is `lastSeen + intervalDays`, so it holds all cycle and changes when the
  // charge lands -- which is what keeps a snoozed "renews soon" snoozed as the date draws nearer,
  // the property the figures were being kept out of the key to protect. `lastSeen` is the charge a
  // lapse was measured from, and `latestAmount` is the new price itself, so one more month at 699
  // cannot re-raise a rise already dealt with while a further rise to 1299 must -- the same
  // reasoning that keys `bill-under-budgeted` on the budgeted figure rather than the average.
  const stateKey = (item: AssessmentRecurringItem, question: string, occurrence: string | number) =>
    `recurring:${foldDescription(item.description)}:${question}:${occurrence}`;

  for (const item of ctx.recurring.newItems.slice(0, RECURRING_NEW_FINDINGS)) {
    out.push(anomaly("recurring-new", "low",
      `${item.description} is a new recurring charge`,
      `First seen on ${item.firstSeen} and charged in ${item.months} months since. It bills about ${item.intervalDays ? `every ${item.intervalDays} days` : "once a month"} and did not exist in the earlier months of the window.`,
      {
        current: item.avgAmount,
        drillDown: chargeDrillDown(item),
        // No `findingKeyEvidence` beside a `stateKey`: `watchlistFindingKey` reads one or the
        // other, so evidence sitting next to a key is never looked at. `firstSeen` carries the
        // identity instead, and a charge is only ever new once from that date.
        stateKey: stateKey(item, "new", item.firstSeen),
      }));
  }

  // Collected per kind so the cap lands on what gets said rather than on which charges are asked.
  // Charges arrive ordered by total spend, so a cap that bites keeps the costliest of each kind.
  const ended: AssessmentAnomaly[] = [];
  const renewing: AssessmentAnomaly[] = [];
  const repriced: AssessmentAnomaly[] = [];

  for (const item of ctx.recurringAll) {
    if (item.isNew || item.months < RECURRING_MIN_MONTHS || item.intervalDays === null) continue;

    if (item.daysOverdue > item.intervalDays * RECURRING_LAPSE_CYCLES) {
      ended.push(anomaly("recurring-ended", "low",
        `${item.description} has stopped charging`,
        `It was charged about every ${item.intervalDays} days, and the last one was on ${item.lastSeen} — ${item.daysOverdue} days past when the next was due. Either it was cancelled, or the payment was not logged.`,
        {
          current: item.avgAmount,
          drillDown: chargeDrillDown(item),
          stateKey: stateKey(item, "ended", item.lastSeen),
        }));
      continue;
    }

    if (item.expectedNextDate !== null && item.daysOverdue === 0
      && daysBetween(ctx.today, item.expectedNextDate) <= RECURRING_RENEWAL_DAYS) {
      renewing.push(anomaly("recurring-renews-soon", "low",
        `${item.description} renews around ${item.expectedNextDate}`,
        `It has been charged every ${item.intervalDays} days or so, and the next one is due within ${RECURRING_RENEWAL_DAYS} days. Cancel it before then if it is not being used.`,
        {
          current: item.avgAmount,
          drillDown: chargeDrillDown(item),
          stateKey: stateKey(item, "renews-soon", item.expectedNextDate),
        }));
    }

    const prior = item.priorAvgAmount;
    if (prior === null || prior === 0) continue;
    const change = pct(item.latestAmount - prior, prior);
    if (change === null || Math.abs(change) < RECURRING_AMOUNT_CHANGE_PCT) continue;
    repriced.push(anomaly("recurring-amount-change", change > 0 ? "medium" : "low",
      `${item.description} now costs ${Math.abs(change)}% ${change > 0 ? "more" : "less"}`,
      `The charge on ${item.lastSeen} is ${Math.abs(change)}% ${change > 0 ? "above" : "below"} the average of the ${item.occurrences - 1} before it. ${change > 0 ? "A price rise" : "A price drop"} on a charge that repeats ${change > 0 ? "costs" : "saves"} that much every cycle from here.`,
      {
        current: item.latestAmount,
        baseline: prior,
        changePct: change,
        drillDown: chargeDrillDown(item),
        // The price *episode*, not the price. A charge that goes 499, 699, 499, 699 rises to 699
        // twice, and keying on the amount alone let the second rise inherit the first's resolution
        // and never appear. `latestAmountSince` holds still while the charge stays at this amount,
        // so one more month at 699 still cannot re-raise a rise already dealt with.
        stateKey: stateKey(item, "amount-change", `${item.latestAmount}@${item.latestAmountSince}`),
      }));
  }
  out.push(
    ...ended.slice(0, RECURRING_FINDINGS_PER_KIND),
    ...renewing.slice(0, RECURRING_FINDINGS_PER_KIND),
    ...repriced.slice(0, RECURRING_FINDINGS_PER_KIND),
  );
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
      {
        current: round(sum(missed.map((b) => b.estimatedArrears))),
        drillDown: { destination: "bills" },
      }));
  }

  const dupes = ctx.hygiene.duplicates.filter((d) => d.inPeriod);
  if (dupes.length > 0) {
    out.push(anomaly("duplicate", "medium", `${dupes.length} possible duplicate entr${dupes.length > 1 ? "ies" : "y"}`,
      `Same day, same description and same amount — usually a double submit. Check ${dupes.slice(0, 2).map((d) => `"${d.description}" on ${d.date}`).join(" and ")}.`,
      {
        current: round(sum(dupes.map((d) => d.amount * (d.copies - 1)))),
        drillDown: {
          destination: "transactions",
          from: dupes[0].date,
          to: dupes[0].date,
          search: dupes[0].description,
        },
        findingKeyEvidence: JSON.stringify(dupes.map(({ date, description, amount, copies, transactionIds }) => ({
          date,
          description,
          amount,
          copies,
          transactionIds,
        }))),
      }));
  }

  const gaps = ctx.confidence.gaps.filter((g) => g.inPeriod);
  if (gaps.length > 0) {
    const worst = gaps[0];
    out.push(anomaly("logging-gap", ctx.confidence.periodCoveragePct < MIN_COVERAGE_PCT ? "high" : "low",
      `${worst.days} days with nothing logged`,
      `Nothing was recorded between ${worst.from} and ${worst.to}, so this period's totals are a floor rather than the whole picture. Coverage is ${ctx.confidence.periodCoveragePct}% of the days elapsed.`,
      { current: ctx.confidence.periodCoveragePct, drillDown: periodDrillDown(ctx) }));
  }
  return out;
};

const SEVERITY_RANK: Record<AiWatchSeverity, number> = { high: 0, medium: 1, low: 2 };
export const sortAssessmentAnomalies = (findings: AssessmentAnomaly[]): AssessmentAnomaly[] =>
  [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

export const detectAnomalies = (ctx: AnomalyContext): AssessmentAnomaly[] =>
  [
    ...detectHygieneAnomalies(ctx),
    ...detectCashFlowAnomalies(ctx),
    ...detectCategorySpikes(ctx),
    ...detectOutlierTransactions(ctx),
    ...detectRecurringAnomalies(ctx),
    ...detectBillAnomalies(ctx),
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
  // `allItems` is peeled off here and never reaches the returned facts: detection needs every
  // charge, the payload wants the top 15.
  const { allItems: recurringAll, ...recurring } =
    computeRecurring(transactions, today, trends.avgMonthlyBurn, input.historyFirstSeen);
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
    today,
    periodMonth,
    // Only clip when the period is a single month still running; a completed one
    // is compared whole, and a multi-month period has no day to clip to.
    throughDay:
      periodMonth !== null && confidence.periodIsPartial ? confidence.periodDaysElapsed : 31,
    periodTx,
    windowTx: transactions,
    confidence,
    bills: billFacts,
    recurring,
    recurringAll,
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
