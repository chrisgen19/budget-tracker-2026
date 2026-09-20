import type {
  Category,
  Transaction,
  TransactionType,
  UserRole,
  ScheduledTransaction,
  BillFrequency,
  BillOccurrenceStatus,
  Label,
  LabelSchedule,
  TransactionLabel,
  BillLabel,
  BudgetAllocationKind,
  SavingsGoalKind,
  SavingsGoalStatus,
} from "@prisma/client";

export type {
  Category,
  Transaction,
  TransactionType,
  UserRole,
  ScheduledTransaction,
  BillFrequency,
  BillOccurrenceStatus,
  Label,
  LabelSchedule,
  TransactionLabel,
  BillLabel,
  BudgetAllocationKind,
  SavingsGoalKind,
  SavingsGoalStatus,
};

/** Transaction with its category (and optional bill) relation */
export type TransactionWithCategory = Transaction & {
  category: Category;
  bill?: ScheduledTransaction | null;
  labels?: (TransactionLabel & { label: Label })[];
  /**
   * The credit card this expense was paid with. Paying the card is a `CreditPayment`, never a
   * transaction, so no row here is a card payment.
   */
  creditAccount?: { id: string; name: string; color: string } | null;
};

/** Label with transaction count */
export type LabelWithCount = Label & {
  _count: { transactions: number };
};

/** Label with transaction count and schedules */
export type LabelWithCountAndSchedules = Label & {
  _count: { transactions: number };
  schedules: LabelSchedule[];
  /**
   * How often this label has been used per category, keyed by category id.
   *
   * Ranking only -- it never restricts what the picker offers, which is the distinction that
   * matters after #304. A category absent from the map means "never used here", not "not allowed
   * here", so a label with no history still appears; it simply sorts below ones with some.
   */
  categoryCounts: Record<string, number>;
};

/** Dashboard summary stats */
export interface DashboardStats {
  totalIncome: number;
  totalExpenses: number;
  balance: number;        // monthly net (selected month only)
  runningBalance: number; // cumulative all-time net up to end of selected month
  /**
   * What the credit cards owe together at the end of the selected month, archived ones included, or
   * null when there is nothing to show: what is still to be paid to the banks. Not simply the gap to
   * cash in the bank, since a card's opening balance is debt from before tracking that was never
   * logged as spending: cash in the bank = runningBalance + this - the cards' opening balances.
   */
  owedOnCards: number | null;
  transactionCount: number;
  recentTransactions: TransactionWithCategory[];
  categoryBreakdown: CategoryBreakdownItem[];
  monthlyTrend: MonthlyTrendItem[];
  balanceTrend: BalanceTrendItem[];
}

export interface CategoryBreakdownItem {
  name: string;
  color: string;
  icon: string;
  amount: number;
  percentage: number;
}

export interface MonthlyTrendItem {
  month: string;
  income: number;
  expenses: number;
}

export interface BalanceTrendItem {
  date: string;   // YYYY-MM-DD
  balance: number;
}

/** Scheduled transaction with its category relation */
export type ScheduledTransactionWithCategory = ScheduledTransaction & {
  category: Category;
  labels?: (BillLabel & { label: Label })[];
  /**
   * Computed next unpaid due date — walks forward past any PAID/SKIPPED logs.
   * Use this for UI "overdue"/"due today" labels instead of `nextDueDate`,
   * which may lag behind due to partial writes or legacy data.
   * Returned as an ISO string by the API; falls back to `nextDueDate` when
   * the display field isn't present.
   */
  displayNextDueDate?: string;
};

/** A pending bill reminder for the banner */
export interface PendingReminder {
  scheduledTransaction: ScheduledTransactionWithCategory;
  dueDate: string;
  isOverdue: boolean;
  daysPastDue: number;
  /** Days until due (0 = today, positive = future). Only meaningful when !isOverdue. */
  daysUntilDue: number;
}

/** Metadata stored on each itemized transaction for future display */
export interface ReceiptBreakdownMeta {
  total: number;
  items: Array<{ name: string; amount: number }>;
}

/** Single item in a multi-receipt scan batch */
export interface MultiScanItem {
  id: string;
  fileName: string;
  status: "scanning" | "success" | "error" | "breaking_down";
  data?: {
    amount?: number;
    description?: string;
    type?: "INCOME" | "EXPENSE";
    date?: string;
    categoryId?: string;
    labelIds?: string[];
    /** The credit card chosen in Paid with while reviewing; null or absent is Bank / cash. */
    creditAccountId?: string | null;
    receiptGroupId?: string;
    receiptBreakdown?: ReceiptBreakdownMeta;
    /** Whether the receipt has items spanning 2+ spending categories */
    multiCategory?: boolean;
    /** True when the scan produced an itemization that failed validation and was discarded.
     *  Distinct from "single-category": both leave `breakdown` unset, but only this one means
     *  Itemize will spend a second scan credit rebuilding what was lost. */
    breakdownDropped?: boolean;
    /** Pre-loaded breakdown from combined scan (avoids second Gemini call) */
    breakdown?: Array<{
      amount: number;
      categoryId: string;
      description: string;
      lineItems: Array<{ name: string; amount: number }>;
    }>;
    /** The year printed on the receipt, when the scan replaced it as a misread digit. Lets the
     *  review name the correction instead of showing a bare "check year". */
    repairedFromYear?: string;
    /** True when the receipt date year differs from the current year (possible POS error) */
    dateWarning?: boolean;
  };
  error?: string;
  /** Compressed image kept in memory for breakdown and retry requests. Set as soon as
   *  compression finishes, including for items whose scan then failed, so a failed row
   *  can be retried without asking the user to pick the photo again. */
  imageFile?: File;
  /** Photo capture date (YYYY-MM-DD) sent to the scan API as the OCR date fallback. */
  photoDate?: string;
  /** Photo capture timestamp in datetime-local form, used when the API reports it fell
   *  back to the photo date rather than reading one off the receipt. */
  photoDateTime?: string;
  /** Set on breakdown children — prevents re-breakdown, enables "Itemized" badge */
  parentId?: string;
}

/** Analytics granularity for time bucketing */
export type AnalyticsGranularity = "weekly" | "monthly" | "yearly";

/** Analytics type filter */
export type AnalyticsTypeFilter = "ALL" | "INCOME" | "EXPENSE";

/** Single period bucket for income/expenses and cash flow */
export interface AnalyticsPeriodItem {
  period: string;       // "2026-03-30", "2026-03", "2026"
  periodLabel: string;  // "Apr 1–7", "Mar 2026", "2026"
  income: number;
  expenses: number;
}

/** Category breakdown item with richer data than dashboard */
export interface AnalyticsCategoryItem {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  percentage: number;
  transactionCount: number;
}

/** Label breakdown item */
export interface AnalyticsLabelItem {
  id: string;
  name: string;
  color: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}

/** Cash flow period (extends period item with net calculations) */
export interface AnalyticsCashFlowItem extends AnalyticsPeriodItem {
  net: number;
  cumulativeNet: number;
}

/** One day of activity for the spending heatmap (dense; every day in range) */
export interface AnalyticsDailyItem {
  date: string;      // "YYYY-MM-DD" in the user's local timezone
  income: number;
  expenses: number;
  count: number;     // transactions that day
}

/** Legend entry for category trends (top expense categories + "other" rollup) */
export interface AnalyticsCategoryTrendSeries {
  id: string;        // categoryId, or "other"
  name: string;
  color: string;
  icon: string;
  total: number;
}

/** One time bucket of per-category expense amounts (zero-filled for all series) */
export interface AnalyticsCategoryTrendPoint {
  period: string;       // same keys as cashFlow buckets
  periodLabel: string;
  values: Record<string, number>;  // seriesId -> amount
}

/** Category trends: top expense categories per time bucket */
export interface AnalyticsCategoryTrends {
  series: AnalyticsCategoryTrendSeries[];  // sorted by total desc, "other" last
  points: AnalyticsCategoryTrendPoint[];
}

/** A top transaction for the largest-transactions widget */
export interface AnalyticsTopTransaction {
  id: string;
  amount: number;
  type: "INCOME" | "EXPENSE";
  description: string;        // falls back to category name
  date: string;               // "YYYY-MM-DD" local
  dateLabel: string;          // "Apr 12" / "Apr 12, 2025" (multi-year aware)
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  labels: Array<{ id: string; name: string; color: string }>;
}

/** Summary totals for the selected range */
export interface AnalyticsSummary {
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  transactionCount: number;
}

/** A notable single transaction record */
export interface AnalyticsTopRecord {
  amount: number;
  description: string;
  date: string;
  category: string;
  categoryIcon: string;
  categoryColor: string;
}

/** Records & statistics for the selected period */
export interface AnalyticsStatistics {
  biggestExpense: AnalyticsTopRecord | null;
  biggestIncome: AnalyticsTopRecord | null;
  mostExpensiveDay: { date: string; total: number; count: number } | null;
  avgDailySpend: number | null;
  avgExpenseSize: number | null;
  avgIncomeSize: number | null;
  totalTransactions: number;
  activeDays: number;
  expenseDays: number;
  totalDaysInPeriod: number;
  spendingStreak: number;
  mostUsedCategory: { name: string; icon: string; color: string; count: number } | null;
  mostExpensiveCategory: { name: string; icon: string; color: string; amount: number } | null;
  categoriesUsed: number;
}

/**
 * Descriptive signals the transaction ledger can support without claiming to
 * measure the user's broader financial health.
 */
export interface AnalyticsCashFlowSignals {
  netCashFlow: number;
  savingsRate: number | null;
  previousSavingsRate: number | null;
  /** Percentage-point movement expressed as a decimal (0.05 = 5 points). */
  savingsRateChange: number | null;
  /** Relative movement from the previous period (0.10 = 10%). */
  expenseChange: number | null;
  /** Relative movement from the previous period (0.10 = 10%). */
  incomeChange: number | null;
  expenseDays: number;
  totalDaysInPeriod: number;
  hasComparableData: boolean;
}

export type AnalyticsComparisonStatus =
  | "available"
  | "low-coverage"
  | "no-previous-data"
  | "not-started"
  | "too-early";

/** How the selected window and automatic previous-period comparison were resolved. */
export interface AnalyticsPeriodContext {
  requestedFrom: string;
  requestedTo: string;
  effectiveTo: string | null;
  isPartial: boolean;
  daysElapsed: number;
  daysInPeriod: number;
  currentCoveragePct: number;
  previousCoveragePct: number;
  comparisonStatus: AnalyticsComparisonStatus;
  coverageThresholdPct: number;
}

/** Full analytics API response */
export interface AnalyticsData {
  categoryBreakdown: AnalyticsCategoryItem[];
  allCategoryBreakdown: AnalyticsCategoryItem[];
  labelBreakdown: AnalyticsLabelItem[];
  cashFlow: AnalyticsCashFlowItem[];
  summary: AnalyticsSummary;
  /** Previous period data for comparison (income & expenses report) */
  previousSummary: AnalyticsSummary;
  previousCategoryBreakdown: AnalyticsCategoryItem[];
  allPreviousCategoryBreakdown: AnalyticsCategoryItem[];
  periodLabel: string;
  previousPeriodLabel: string;
  statistics: AnalyticsStatistics;
  cashFlowSignals: AnalyticsCashFlowSignals;
  periodContext: AnalyticsPeriodContext;
  /** Dense per-day series for the spending heatmap */
  daily: AnalyticsDailyItem[];
  /** Top expense categories per time bucket */
  categoryTrends: AnalyticsCategoryTrends;
  /** Largest transactions in the period (respects the type filter) */
  topTransactions: AnalyticsTopTransaction[];
}

/* ------------------------------------------------------------------ */
/*  Monthly budget plans                                               */
/* ------------------------------------------------------------------ */

export type BudgetForecastStatus = "available" | "no-activity" | "not-started";

export interface BudgetPerformanceAllocation {
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  type: "INCOME" | "EXPENSE";
  kind: BudgetAllocationKind;
  planned: number;
  rolloverEnabled: boolean;
  rolloverCarryIn: number;
  available: number;
  actual: number;
  remaining: number;
  varianceAmount: number;
  variancePct: number | null;
  projectedActual: number | null;
  forecastToExceed: boolean;
  projectionBasis: string;
  rolloverCarryOut: number | null;
}

export interface BudgetPerformanceTotals {
  plannedIncome: number;
  actualIncome: number;
  plannedExpenses: number;
  availableExpenses: number;
  actualExpenses: number;
  unbudgetedExpenses: number;
  remainingExpenses: number;
  projectedExpenses: number | null;
  projectedVariance: number | null;
}

export interface BudgetSafeToSpend {
  remainingFlexible: number;
  perDay: number | null;
  perWeek: number | null;
  untilNextIncome: number | null;
  nextIncomeDate: string | null;
  daysUntilNextIncome: number | null;
  basis: string;
}

export interface BudgetPerformanceData {
  month: string;
  periodLabel: string;
  progress: {
    isPartial: boolean;
    daysElapsed: number;
    daysInMonth: number;
    percentElapsed: number;
    effectiveTo: string | null;
  };
  plan: null | {
    id: string;
    revision: number;
    revisionCount: number;
    createdAt: string;
    history: Array<{ id: string; revision: number; createdAt: string }>;
  };
  allocations: BudgetPerformanceAllocation[];
  totals: BudgetPerformanceTotals;
  safeToSpend: BudgetSafeToSpend;
  forecastStatus: BudgetForecastStatus;
  treatmentNotes: string[];
}

/* ------------------------------------------------------------------ */
/*  AI Assessment                                                      */
/* ------------------------------------------------------------------ */

/** Severity for a "watch list" item in the AI assessment */
export type AiWatchSeverity = "high" | "medium" | "low";

/** A flagged area the user should keep an eye on */
export interface AiWatchItem {
  title: string;
  detail: string;
  severity: AiWatchSeverity;
}

/** A category/habit the AI suggests cutting back, with an optional est. monthly saving */
export interface AiCutBackItem {
  title: string;
  reason: string;
  suggestion: string;
  /** Estimated monthly saving in the user's currency (number; masked client-side) */
  estimatedMonthlySaving: number | null;
}

/** A titled tip with a short body (used for savings strategy & earn ideas) */
export interface AiTip {
  title: string;
  detail: string;
}

/** A web-informed tip surfaced via Google Search grounding */
export interface AiWebTip {
  title: string;
  detail: string;
}

/** A grounding source (from Gemini grounding metadata) backing the web tips */
export interface AiSource {
  title: string;
  url: string;
}

/** A pattern the assessment found in the period, grounded in a computed fact. */
export interface AiPatternItem {
  title: string;
  detail: string;
  severity: AiWatchSeverity;
}

/** Where a category is heading, read against the trustworthy baseline months. */
export interface AiTrendItem {
  title: string;
  detail: string;
  direction: "up" | "down" | "new" | "stable";
}

/**
 * An accuracy problem rather than a money problem.
 *
 * Kept as its own list because the two need separating: "your July spending fell"
 * is wrong when July is a logging gap, and telling someone to be more frugal
 * about a number that is simply missing rows is worse than saying nothing.
 */
export interface AiDataQualityItem {
  title: string;
  detail: string;
  fix: string;
}

/** Full AI assessment report content (stored as JSON, validated by Zod) */
export interface AiAssessmentReport {
  summary: string;
  /** What the descriptive cash-flow signals mean, without assigning a health grade. */
  cashFlowCommentary: string;
  /** What the next few weeks look like given bills due and the current run rate. */
  outlook: string;
  /** What went wrong (or unusually) in this period, grounded in `AssessmentFacts`. */
  patterns: AiPatternItem[];
  /** Where categories are heading against their own baseline. */
  trends: AiTrendItem[];
  /** Logging gaps, duplicates, unlinked bill payments — the numbers being wrong. */
  dataQuality: AiDataQualityItem[];
  watchList: AiWatchItem[];
  cutBack: AiCutBackItem[];
  boostSavings: AiTip[];
  earnIdeas: AiTip[];
  quickActions: string[];
  webTips: AiWebTip[];
  /** Grounding sources backing the web tips (may be empty) */
  sources: AiSource[];
}

/** Lightweight daily save/earn micro-tip */
export interface AiDailyTip {
  tip: string;
  rationale: string;
}

/** GET /api/assessment response: the cached report (or null) + when it was made */
export interface AiAssessmentResponse {
  report: AiAssessmentReport | null;
  generatedAt: string | null;
  model: string | null;
}

/** GET /api/assessment/daily-tip response */
export interface AiDailyTipResponse {
  tip: AiDailyTip | null;
  generatedAt: string | null;
}

/* ------------------------------------------------------------------ */
/*  AI Assessment — deterministic facts                                */
/* ------------------------------------------------------------------ */

/**
 * How much of a month was actually logged.
 *
 * A month logged on 16 of 31 days is a logging gap, not a cheap month, and
 * averaging it into a trend drags every downstream figure toward a number
 * nothing actually spent. Every rate, average and trend below reads only the
 * months this marks `ok`.
 */
export interface AssessmentMonthCoverage {
  /** "YYYY-MM" in the user's own calendar. */
  month: string;
  /** "Aug 2026" */
  label: string;
  daysLogged: number;
  daysInMonth: number;
  coveragePct: number;
  transactionCount: number;
  income: number;
  expenses: number;
  /** `partial` is the month still in progress — incomplete by definition, never a trend. */
  status: "ok" | "low-coverage" | "partial";
}

/** A stretch inside the window with nothing logged at all. */
export interface AssessmentLoggingGap {
  /** Last day with a transaction before the gap. */
  from: string;
  /** First day with a transaction after it. */
  to: string;
  days: number;
  /** True when the gap falls inside the period being assessed. */
  inPeriod: boolean;
}

export interface AssessmentDataConfidence {
  months: AssessmentMonthCoverage[];
  /** "YYYY-MM" keys that passed the coverage gate — the basis of every trend. */
  trustworthyMonths: string[];
  excludedMonths: string[];
  gaps: AssessmentLoggingGap[];
  /** Coverage of the selected period itself, 0-100. */
  periodCoveragePct: number;
  /** True when the period has not finished yet (the current month, this week). */
  periodIsPartial: boolean;
  /** Days of the period elapsed so far / in total — the basis of the pace projection. */
  periodDaysElapsed: number;
  periodDaysTotal: number;
}

/** What a bill's budgeted figure is worth, measured against what it has actually cost. */
export interface AssessmentBillAccuracy {
  id: string;
  description: string;
  categoryName: string;
  budgeted: number;
  isVariable: boolean;
  payments: number;
  avgPaid: number | null;
  lowest: number | null;
  highest: number | null;
  /** highest / lowest. Under ~1.5 is a fixed bill, so a variance there is a wrong figure. */
  swing: number | null;
  /** Average paid vs budgeted, as a percentage. */
  variancePct: number | null;
  /**
   * `seasonal` needs two things: payments swinging 2x or more **and** a budget
   * that falls inside the range actually paid, so it is right for part of the
   * year. A bill budgeted at 100 and paid 300-600 swings 2x and is simply wrong.
   */
  verdict: "ok" | "under-budgeted" | "over-budgeted" | "seasonal" | "no-payments";
  /**
   * What each billing period actually cost, oldest first.
   *
   * Carried only for a `seasonal` bill, where the shape is the finding: no single
   * figure is right, so "which months run high" is the only useful answer. Months
   * are printed rather than seasons — which ones run hot depends on the
   * hemisphere and the household.
   */
  monthlySeries: Array<{ month: string; label: string; amount: number }>;
}

/** A bill occurrence that came due and was never paid, skipped or snoozed. */
export interface AssessmentMissedBill {
  id: string;
  description: string;
  categoryName: string;
  /** What the next one is likely to cost — derived for a variable bill. */
  amount: number;
  isEstimate: boolean;
  /** Every unsettled occurrence, oldest first, as "YYYY-MM-DD". */
  missedDueDates: string[];
  /** Days since the oldest unsettled occurrence. */
  daysOverdue: number;
  /** Sum of `amount` across the missed occurrences — what catching up would cost. */
  estimatedArrears: number;
}

/**
 * Spending that matches a bill by name but was never linked to it, so the schedule never advanced.
 *
 * Read across the user's **whole history**, not the assessment window. The finding
 * is about the bill's integrity rather than about this period's spending: a
 * payment made outside the bill system two years ago still left the schedule
 * wrong, and it stays wrong until someone notices.
 */
export interface AssessmentUnlinkedBillPayment {
  billId: string;
  billDescription: string;
  count: number;
  total: number;
  /** Days the most recent unlinked payment happened on, newest first. */
  recentDates: string[];
}

/**
 * The figures a reader wants before any of the detail.
 *
 * `runningBalance` is deliberately all-time, not windowed: it is what the account
 * actually holds, and a six-month slice of it is not a balance. Runway divides it
 * by the burn of the trustworthy months only, so a logging gap cannot flatter it.
 */
export interface AssessmentHeadline {
  /** Months the rates below are averaged over — the trustworthy ones. */
  months: number;
  income: number;
  expenses: number;
  net: number;
  savingsRatePct: number | null;
  avgMonthlyBurn: number | null;
  /**
   * Every income minus every expense, across the user's whole history.
   *
   * Null when the caller did not supply all-time totals. Deliberately not zero:
   * a balance of nothing and a balance nobody asked for render identically, and
   * one of them is a figure this report invented.
   */
  runningBalance: number | null;
  /** Months of typical spending the balance covers **if income stopped**. Null when unknowable. */
  monthsOfRunway: number | null;
}

/** A bill that has not come due yet but will shortly - a claim on cash, not a problem. */
export interface AssessmentDueSoonBill {
  id: string;
  description: string;
  categoryName: string;
  /** "YYYY-MM-DD" in the user's own calendar. */
  dueDate: string;
  daysUntilDue: number;
  /** What it is likely to cost - derived for a variable bill, the stored figure otherwise. */
  amount: number;
  isEstimate: boolean;
}

/**
 * One occurrence deferred again and again rather than paid or skipped.
 *
 * Counted per *occurrence*, not per bill: a bill snoozed once a month for a year is twelve
 * separate decisions about twelve separate charges, while the same charge deferred four times is
 * one bill nobody intends to pay. Only the second is worth saying anything about.
 *
 * Each fresh snooze of an occurrence writes its own log row (`settleBill` only collapses a retry
 * against a deferral that has not yet lapsed), so the row count is the decision count.
 */
export interface AssessmentSnoozedBill {
  id: string;
  description: string;
  categoryName: string;
  /** The occurrence being deferred, "YYYY-MM-DD". */
  dueDate: string;
  snoozes: number;
  /** When the current deferral runs out, or null when it already has. */
  snoozedUntil: string | null;
  amount: number;
  isEstimate: boolean;
}

export interface AssessmentBillFacts {
  /** Resolved against the user's own calendar day, not the server's. */
  asOf: string;
  missed: AssessmentMissedBill[];
  accuracy: AssessmentBillAccuracy[];
  unlinkedPayments: AssessmentUnlinkedBillPayment[];
  /** Bills due within the next 14 days, as a forward-looking claim on cash. Soonest first. */
  dueSoon: AssessmentDueSoonBill[];
  dueSoonCount: number;
  dueSoonTotal: number;
  dueSoonIsEstimate: boolean;
  /** Occurrences deferred repeatedly, most-deferred first. */
  repeatedlySnoozed: AssessmentSnoozedBill[];
}

/** One category's movement between the compared month and the baseline months. */
export interface AssessmentCategoryMovement {
  category: string;
  type: TransactionType;
  current: number;
  priorAvg: number;
  /** Null when there is no baseline to compare against (a debut). */
  changePct: number | null;
  /** Absolute movement, which is what the list is ranked by. */
  change: number;
  direction: "up" | "down" | "new";
  /** Months the baseline averaged over. */
  baselineMonths: number;
}

export interface AssessmentTrendFacts {
  /** "YYYY-MM" the movements describe. */
  comparedMonth: string | null;
  comparedMonthLabel: string | null;
  /** The trustworthy months averaged to form the baseline. */
  baselineMonths: string[];
  movements: AssessmentCategoryMovement[];
  /** Net cash flow per trustworthy month, oldest first — the shape behind the headline. */
  monthlyNet: Array<{ month: string; label: string; income: number; expenses: number; net: number }>;
  /** Savings rate across the trustworthy months, 0-100, or null with no income. */
  baselineSavingsRatePct: number | null;
  avgMonthlyBurn: number | null;
}

/** Something charged in most months — the fixed base under the discretionary spending. */
export interface AssessmentRecurringItem {
  description: string;
  months: number;
  occurrences: number;
  avgAmount: number;
  total: number;
  /** First seen inside the last 120 days: a habit forming rather than an old one. */
  isNew: boolean;
  firstSeen: string;
  lastSeen: string;
  /**
   * Median days between consecutive charge days — the cadence, not a nominal billing period.
   *
   * Measured rather than assumed: a "monthly" subscription billed on the 1st has a cadence of
   * 28-31 days depending on the months it has run through, and a median is what survives that
   * without a calendar model nobody maintains. Null with fewer than two charge days, where there
   * is no gap to measure.
   */
  intervalDays: number | null;
  /** `lastSeen` plus `intervalDays`, or null without a cadence. When the next charge is due. */
  expectedNextDate: string | null;
  /** Days past `expectedNextDate`, 0 when it has not arrived yet or is unknown. */
  daysOverdue: number;
  /**
   * The most recent charge's amount.
   *
   * One charge, not the day's total: several rows on one day are a double submit far more often
   * than a genuine price rise, and summing them would report the duplicate as one.
   */
  latestAmount: number;
  /** Average of every charge before the latest, or null when the latest is the only one. */
  priorAvgAmount: number | null;
  /**
   * The day the charge last *became* its current amount: the first of the unbroken run at
   * `latestAmount`, which is `lastSeen` itself when the newest charge differs from the one before.
   *
   * The identity of a price episode, as distinct from the price. A charge that goes 499, 699, 499,
   * 699 has two separate rises to 699, and keying a finding on the amount alone made the second one
   * inherit the first one's resolution and vanish.
   */
  latestAmountSince: string;
}

export interface AssessmentRecurringFacts {
  items: AssessmentRecurringItem[];
  newItems: AssessmentRecurringItem[];
  /** Monthly cost of everything recurring, as a share of average monthly spend. */
  monthlyBase: number;
  monthlyBasePct: number | null;
  /**
   * Deposits that arrive on a rhythm, largest first - a salary, an allowance, a standing transfer.
   *
   * The same shape and the same cadence arithmetic as the expense side, asked of the other half of
   * the ledger. `isNew` is always false here: a new income source is good news nobody needs an
   * alert about.
   */
  income: AssessmentRecurringItem[];
}

/** Two rows the same day, description and amount — almost always a double submit. */
export interface AssessmentDuplicateGroup {
  date: string;
  description: string;
  amount: number;
  copies: number;
  /** Source rows, so a replacement duplicate is a new finding even if its prose is unchanged. */
  transactionIds: string[];
  inPeriod: boolean;
}

/** One thing stored several ways, which the Telegram bot's description search cannot see through. */
export interface AssessmentFragmentation {
  normalized: string;
  variants: string[];
  transactions: number;
}

export interface AssessmentHygieneFacts {
  duplicates: AssessmentDuplicateGroup[];
  /**
   * Unlabeled spend split by cause. Bill payments bypass label auto-apply, so
   * those are a system gap rather than user sloppiness, and saying which it is
   * matters more than the total.
   */
  unlabeled: {
    fromBills: { count: number; total: number };
    manual: { count: number; total: number };
    pctOfSpend: number;
  };
  fragmentation: AssessmentFragmentation[];
  /** Share of income from the single largest source — concentration risk. */
  incomeConcentrationPct: number | null;
  topIncomeSource: string | null;
  /** Every income source in the trustworthy months, largest first. */
  incomeSources: Array<{ source: string; count: number; total: number; pct: number | null }>;
}

/** One contribution into a goal, or a withdrawal back out of it (a negative amount). */
export interface SavingsGoalContributionRow {
  id: string;
  amount: number;
  /** "YYYY-MM-DD" in the user's own calendar. */
  date: string;
  note: string | null;
}

/**
 * Whether a goal will arrive on time, and what it would take.
 *
 * `requiredMonthly` answers "what should I be putting in"; `projectedCompletion` runs the rate
 * actually observed forward and answers "what will happen". The two disagreeing is the finding.
 */
export interface SavingsGoalPace {
  remaining: number;
  /**
   * What is left divided by the months left, or null when there is no deadline or it has passed.
   * Null is not zero: zero would read as "nothing more needed".
   */
  requiredMonthly: number | null;
  /**
   * The rate this goal has actually been funded at, measured from its **first contribution** and
   * not from the day it was created - a goal set up in January and first funded in June has been
   * running one month, and dividing by six condemns a saver who is on track.
   *
   * The opening deposit is excluded from the numerator, because it did not accrue over the window
   * it opens: counting it divides N deposits by the N-1 intervals between them and overstates the
   * rate by N/(N-1). Null until a second contribution exists on a later day - one deposit is an
   * amount, not a rate.
   */
  observedMonthly: number | null;
  /** Days to the target date; negative once it has passed, null without one. */
  daysRemaining: number | null;
  /** Where the observed rate lands the goal, or null when there is no rate to run forward. */
  projectedCompletion: string | null;
  /**
   * - `funded` - the target is met.
   * - `on-track` / `behind` - the observed rate against what is required, within a tolerance.
   * - `stalled` - a deadline, but nothing in yet (or it all came back out).
   * - `underway` - money is going in, but not from enough days to state a rate. Distinct from
   *   `stalled`, which asserts the opposite and was being reported for it.
   * - `overdue` - the date has passed and it is still short.
   * - `no-deadline` - progress is knowable, pace is not. Not an error and not "fine".
   */
  state: "funded" | "on-track" | "behind" | "stalled" | "underway" | "overdue" | "no-deadline";
}

/** Everything the goals page and the Watchlist read about one goal. */
export interface SavingsGoalSummary {
  id: string;
  name: string;
  kind: SavingsGoalKind;
  status: SavingsGoalStatus;
  targetAmount: number;
  targetDate: string | null;
  notes: string | null;
  /** The signed sum of every contribution - money assigned on purpose, never a residual. */
  funded: number;
  /** Clamped to 100 for the progress bar; `funded` keeps the real figure. */
  fundedPct: number;
  lastContributedOn: string | null;
  contributionCount: number;
  pace: SavingsGoalPace;
}

/** One claim on cash between today and the next expected deposit. */
export interface AssessmentCashClaim {
  /** "YYYY-MM-DD" in the user's own calendar. */
  date: string;
  label: string;
  amount: number;
  /**
   * A scheduled bill, or a charge that simply keeps coming back.
   *
   * A recurring charge that matches a bill by name is left out entirely: bill payments are
   * ordinary transactions, so the same money is already in the schedule and counting both would
   * forecast a shortfall that only exists in the arithmetic.
   */
  source: "bill" | "recurring";
}

/**
 * Where the tracked balance is headed before money next comes in.
 *
 * **Directional, and the wording everywhere says so.** `openingBalance` is `headline.runningBalance`
 * - every income the user has logged minus every expense - which is not a bank balance: it knows
 * nothing about the money that was in the account before tracking began, nothing about anything
 * spent without being logged, and nothing about a card's opening balance. It is the only balance
 * the app has until accounts and opening balances are modelled, and a forecast built on it is
 * worth having as long as it is never dressed up as a statement.
 */
export interface AssessmentCashForecast {
  /** Null when the caller supplied no all-time totals; deliberately not zero. */
  openingBalance: number | null;
  /** The last day of the projection: the next expected deposit, or the horizon cap. */
  through: string;
  /** When money is next expected in, or null when no source has a rhythm to project from. */
  nextIncomeDate: string | null;
  /** The lowest the tracked balance is projected to reach, and the day it happens. */
  lowestBalance: number | null;
  lowestOn: string | null;
  /** Everything claimed against the balance before `through`, soonest first. */
  claims: AssessmentCashClaim[];
  committed: number;
}

/** A pattern in the assessed period that the baseline says should not be there. */
export type AssessmentAnomalyKind =
  | "budget-threshold"
  | "budget-forecast"
  | "category-spike"
  | "new-category"
  | "outlier-transaction"
  | "overspend"
  | "savings-drop"
  | "pace"
  | "missing-income"
  | "duplicate"
  | "logging-gap"
  | "missed-bill"
  | "recurring-new"
  | "recurring-ended"
  | "recurring-amount-change"
  | "recurring-renews-soon"
  | "bill-due-soon"
  | "bill-snoozed"
  | "bill-under-budgeted"
  | "missing-expected-income"
  | "low-coverage"
  | "insufficient-history"
  | "goal-off-pace"
  | "goal-stalled"
  | "cash-shortfall";

/**
 * Whether a finding is measured inside the selected period, or describes a standing condition
 * that the period does not bound.
 *
 * Nearly everything is `"period"`: the producers filter on `inPeriod`, or compare the period
 * against baseline months. `missed-bill` is the exception, and deliberately so: bills are judged
 * against their own full payment history rather than the window, which is what makes "no payment
 * recorded since June" sayable at all.
 *
 * It is carried on the finding because the consumer cannot infer it. The Watchlist rendered every
 * anomaly under "findings from this period" and so attributed a live overdue bill to whatever
 * period was selected: on February 2019, a month with no transactions, it reported a 2026 bill
 * (#340).
 *
 * Assigned from `ANOMALY_SCOPE`, an exhaustive `Record` over the kinds rather than an argument
 * with a default: a default is the shape that silently mislabels the next unscoped finding
 * somebody adds, where a missing entry in the map will not compile.
 */
export type AssessmentAnomalyScope = "period" | "outstanding";

/** The most focused destination available for a Watchlist finding. */
export interface AssessmentAnomalyDrillDown {
  destination: "transactions" | "bills" | "goals";
  type?: TransactionType;
  categoryId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface AssessmentAnomaly {
  kind: AssessmentAnomalyKind;
  /** Whether the selected period bounds this finding. See `AssessmentAnomalyScope`. */
  scope: AssessmentAnomalyScope;
  title: string;
  /** Relative/percentage prose — amounts travel in the numeric fields so the UI can mask them. */
  detail: string;
  severity: AiWatchSeverity;
  /** The figure this period, where one applies. */
  current: number | null;
  /** What the trustworthy months said to expect. */
  baseline: number | null;
  changePct: number | null;
  /** Optional narrowing for the Watchlist's per-finding follow-up link. */
  drillDown?: AssessmentAnomalyDrillDown;
  /** Exact deterministic evidence used only to decide whether a saved action still applies. */
  findingKeyEvidence?: string;
  /** Stable identity for an actionable finding whose display metrics change with time. */
  stateKey?: string;
}

/** Everything the assessment knows for certain, computed from the database rather than inferred. */
export interface AssessmentFacts {
  generatedAt: string;
  currency: string;
  period: { from: string; to: string; label: string; granularity: string };
  /** The history the trends read, ending with the period's own month. */
  window: { from: string; to: string; months: number };
  confidence: AssessmentDataConfidence;
  headline: AssessmentHeadline;
  bills: AssessmentBillFacts;
  /** Where the tracked balance is headed before money next comes in. Directional, never a promise. */
  forecast: AssessmentCashForecast;
  trends: AssessmentTrendFacts;
  recurring: AssessmentRecurringFacts;
  hygiene: AssessmentHygieneFacts;
  /** Ranked most severe first. */
  anomalies: AssessmentAnomaly[];
}

/** GET /api/assessment/facts response. */
export interface AssessmentFactsResponse {
  facts: AssessmentFacts;
  /** Only decisions that currently suppress a finding; missing means active. */
  findingStates: Record<string, "RESOLVED" | "SNOOZED">;
}
