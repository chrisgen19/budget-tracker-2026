import type { PrismaClient } from "@prisma/client";

// Re-export PrismaClient type for convenience
export type { PrismaClient };

// Common filter types
export type TransactionType = "INCOME" | "EXPENSE";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * A window that may be open at either end.
 *
 * A one-sided range is a real request ("everything since payday"), and the missing side has to
 * stay missing. Substituting the epoch or the maximum instant for it looks harmless and is not:
 * `new Date(0)` silently excludes anything recorded before 1970, and it makes a lone
 * `to: "1969-12-31"` fail an ordering check against a `from` the caller never sent.
 */
export interface OpenDateRange {
  startDate: Date | null;
  endDate: Date | null;
}

/**
 * A date window, given as either a month or an explicit range of local days.
 *
 * `month` and `from`/`to` are mutually exclusive rather than one quietly winning: a filter that
 * applies half of what was asked returns rows that read exactly like a complete answer, which is
 * the same reason an unresolvable label name is dropped rather than passed through.
 *
 * Both range bounds are inclusive and resolved in the user's timezone, so `to: "2026-08-29"`
 * covers that whole day rather than stopping at its first instant.
 */
export interface PeriodParams {
  /** Format: YYYY-MM. Mutually exclusive with `from`/`to`. */
  month?: string;
  /** First local day to include, YYYY-MM-DD. Open at the start when omitted. */
  from?: string;
  /** Last local day to include, YYYY-MM-DD, inclusive of the whole day. Open at the end when omitted. */
  to?: string;
}

/**
 * The window a query actually ran over, echoed back to the caller.
 *
 * Every row comes back as a UTC instant, so a client asking for "this week" would otherwise have
 * to re-derive the window from timestamps and its own idea of the timezone -- which is exactly
 * where a UTC+8 user's late-evening row lands on the wrong day. Stating the resolved window in
 * the user's own calendar days lets the caller report the period it was given instead of
 * inferring one.
 */
export interface ResolvedPeriod {
  /** The month filtered on in YYYY-MM, or null when an explicit `from`/`to` range was used. */
  month: string | null;
  /** First local day included, YYYY-MM-DD. Null when the window is open at the start. */
  from: string | null;
  /** Last local day included, YYYY-MM-DD. Null when the window is open at the end. */
  to: string | null;
}

// --- get_spending_by_category ---

/** Defaults to the current month when no period is given. */
export interface SpendingByCategoryParams extends PeriodParams {
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Period boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface CategorySpending {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  amount: number;
  percentage: number;
}

// --- get_top_expenses ---

/** Covers all time when no period is given. */
export interface TopExpensesParams extends PeriodParams {
  /** Number of results to return. Defaults to 10 */
  limit?: number;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Period boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface TopExpense {
  id: string;
  amount: number;
  description: string;
  /** The stored instant, ISO 8601 in UTC. */
  date: string;
  /** The same moment as the user's own calendar day, YYYY-MM-DD. See `SearchTransactionsResult`. */
  localDate: string;
  categoryName: string;
  categoryIcon: string;
}

// --- get_monthly_summary ---

export interface MonthlySummaryParams {
  /** Number of months to look back. Defaults to 6 */
  months?: number;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Month boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface MonthSummary {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

// --- get_spending_trends ---

export interface SpendingTrendsParams {
  /** Format: YYYY-MM (current period) */
  currentMonth: string;
  /** Format: YYYY-MM (comparison period) */
  previousMonth: string;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Month boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface CategoryTrend {
  name: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number | null;
}

export interface SpendingTrends {
  currentTotal: number;
  previousTotal: number;
  totalChange: number;
  totalChangePercent: number | null;
  byCategory: CategoryTrend[];
}

// --- search_transactions ---

/** Covers all time when no period is given. */
export interface SearchTransactionsParams extends PeriodParams {
  /** Search term for description (case-insensitive) */
  search?: string;
  /** Filter by type */
  type?: TransactionType;
  /** Filter by category ID */
  categoryId?: string;
  /** Minimum amount */
  amountMin?: number;
  /** Maximum amount */
  amountMax?: number;
  /** Sort field. Defaults to "date" */
  sortBy?: "date" | "amount";
  /** Sort direction. Defaults to "desc" */
  sortDir?: "asc" | "desc";
  /** Which surface created the row. Omit for any. */
  createdVia?: "APP" | "MCP" | "TELEGRAM";
  /** Page number. Defaults to 1 */
  page?: number;
  /** Results per page. Defaults to 20 */
  limit?: number;
  /** Only transactions carrying at least one of these label IDs */
  labelIds?: string[];
  /** Drop `categoryIcon` and `categoryColor` from each row. They exist for the app's UI and no
   *  analysis reads them, but they are ~20% of a page's bytes, which is context a model spends
   *  instead of reasoning. */
  compact?: boolean;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Month boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface TransactionTotals {
  /** Every matching row, not just the page. */
  count: number;
  income: number;
  expenses: number;
  /** `income - expenses`. */
  net: number;
  /** Every matching row grouped by category, largest first. */
  byCategory: Array<{
    categoryId: string;
    categoryName: string;
    amount: number;
    count: number;
  }>;
}

export interface SearchTransactionsResult {
  transactions: Array<{
    id: string;
    amount: number;
    description: string;
    type: TransactionType;
    /** The stored instant, ISO 8601 in UTC. Keep using this for ordering and time-of-day. */
    date: string;
    /**
     * The same moment rendered as the user's own calendar day, YYYY-MM-DD.
     *
     * A UTC+8 user's 26 August 06:00 row is stored as `2026-08-25T22:00:00Z`, so a caller
     * slicing `date` reports the 25th for a transaction the app shows on the 26th. The write
     * path has echoed the local day since it was written; the read path returned raw UTC and
     * left every client to redo the conversion, which is precisely where it goes wrong.
     */
    localDate: string;
    categoryName: string;
    /** Omitted when `compact` was set. */
    categoryIcon?: string;
    /** Omitted when `compact` was set. */
    categoryColor?: string;
    /** Ties together the rows of one multi-category receipt, `null` for an ordinary transaction.
     *  Three rows sharing one of these are one shop, not three; without it a caller can only
     *  guess that from matching timestamps and a shared description prefix. */
    receiptGroupId: string | null;
    labels: Array<{ id: string; name: string; color: string }>;
  }>;
  /** The window actually queried, or null when no period was given. */
  period: ResolvedPeriod | null;
  /** Aggregates over every match, so a caller never has to sum a page to answer "how much". */
  totals: TransactionTotals;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// --- get_budget_overview ---

/** Defaults to the current month when no period is given. */
export interface BudgetOverviewParams extends PeriodParams {
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Period boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface BudgetOverview {
  /** The month covered, or null when an explicit `from`/`to` range was used. */
  month: string | null;
  /** The window actually queried. */
  period: ResolvedPeriod;
  /**
   * The user's current calendar day, YYYY-MM-DD.
   *
   * Nothing else in the tool set tells a client what "today" is. A client with a shell can work
   * it out; Claude on mobile and an editor agent cannot, and a model that guesses guesses in UTC
   * -- which makes "this week" unanswerable rather than merely approximate.
   */
  today: string;
  /** Minutes, `getTimezoneOffset()` convention (UTC+8 is -480), so a client can resolve its own
   *  relative dates against the same zone the server used. */
  timezoneOffset: number;
  totalIncome: number;
  totalExpenses: number;
  net: number;
  runningBalance: number;
  transactionCount: number;
}

// --- get_upcoming_bills ---

export interface UpcomingBillsParams {
  /** Number of days to look ahead. Defaults to 7 */
  days?: number;
  /** User's timezone offset in minutes; when set, "today"/overdue are computed in the
   *  user's local day (matching /api/bills/upcoming). Omit to use the server's local day. */
  timezoneOffset?: number;
}

export interface UpcomingBill {
  id: string;
  description: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  amount: number;
  /** The stored value as an ISO instant. Kept for callers that already read it. */
  dueDate: string;
  /**
   * The calendar day the bill falls due, YYYY-MM-DD.
   *
   * Deliberately *not* timezone-converted, unlike a transaction's `localDate`. A due date is a
   * date-only fact stored at midnight UTC and meaning "the 5th"; shifting it into a zone west of
   * UTC moves it to the 4th, which turns every on-time payment into a day late. So this is the
   * same day for every reader, and reporting it as a bare day is what stops a model reading
   * `2026-08-05T00:00:00.000Z` and calling it 4 August.
   *
   * That "stored at midnight UTC" is a real dependency and not a guarantee: the write paths
   * normalise with `setHours(0, 0, 0, 0)`, which is *process-local* midnight, so it holds only
   * while the server runs in UTC. Production does, by base-image default rather than by
   * contract, and `nixpacks.toml` pins no `TZ`. Normalising those writes is tracked in #184.
   */
  localDueDate: string;
  isOverdue: boolean;
}

export interface UpcomingBillsResult {
  count: number;
  totalAmount: number;
  bills: UpcomingBill[];
}

// --- get_category_list ---

export interface CategoryListParams {
  /** Filter by type */
  type?: TransactionType;
}

export interface CategoryItem {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;
  color: string;
  isDefault: boolean;
}

// --- get_label_breakdown ---

/** Defaults to the current month when no period is given. */
export interface LabelBreakdownParams extends PeriodParams {
  /** Restrict to one transaction type. Defaults to EXPENSE */
  type?: TransactionType;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Period boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface LabelBreakdownItem {
  /** Label id, or the literal "unlabeled" for the catch-all entry */
  id: string;
  name: string;
  color: string;
  /** Sum of each transaction's amount divided by how many labels it carries */
  amount: number;
  /** Share of the period total, labeled or not */
  percentage: number;
  /** Counts a transaction once per label it carries */
  transactionCount: number;
}

export interface LabelBreakdown {
  /** The month covered, or null when an explicit `from`/`to` range was used. */
  month: string | null;
  /** The window actually queried. */
  period: ResolvedPeriod;
  type: TransactionType;
  /** Total across all transactions of this type in the period, labeled or not */
  total: number;
  labels: LabelBreakdownItem[];
}

// --- get_label_list ---

export interface LabelListParams {
  /** Only labels usable on this transaction type (matches "BOTH" too) */
  applicableTo?: TransactionType;
}

export interface LabelItem {
  id: string;
  name: string;
  color: string;
  /** "EXPENSE" | "INCOME" | "BOTH" -- which transaction types the label may be used on */
  applicableTo: string;
  transactionCount: number;
  /** Auto-apply rules: transactions created in these windows get the label */
  schedules: Array<{ days: number[]; startTime: string; endTime: string }>;
}

// --- get_bill_history ---

export interface BillHistoryParams {
  /** Restrict to one bill. Omit to cover every bill the user has */
  billId?: string;
  /** Restrict to one outcome. Matched against the occurrence's settled outcome, so a
   *  snoozed-then-paid occurrence counts as PAID, not SNOOZED. */
  status?: BillOccurrenceStatus;
  /** How many months back to look. Defaults to 6 */
  months?: number;
  /** Max occurrences returned. Summaries still cover the whole window. Defaults to 50 */
  limit?: number;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480). Lateness is measured in the user's calendar days. */
  timezoneOffset?: number;
}

export type BillOccurrenceStatus = "PAID" | "SKIPPED" | "SNOOZED";

/**
 * One scheduled occurrence of a bill, which is a (bill, dueDate) pair.
 *
 * A single occurrence can produce several log rows: snoozing does not settle it, so it can
 * be snoozed repeatedly and then paid or skipped. Those rows are collapsed here, so this is
 * genuinely one entry per scheduled occurrence rather than one per user action.
 */
export interface BillOccurrence {
  billId: string;
  billDescription: string;
  categoryName: string;
  /** The bill's *current* configured amount, which may have been edited since */
  amount: number;
  /** What the linked transaction actually recorded, which can differ from `amount`: Pay &
   *  Edit lets the amount be changed at pay time, and editing the bill later rewrites
   *  `amount` for every past occurrence. `null` unless the occurrence created a transaction.
   *  Matches `paidAmount` on `/api/bills/[id]/history`. */
  paidAmount: number | null;
  /** The date this occurrence was due, as an ISO instant. Render `localDueDate` instead. */
  dueDate: string;
  /** The calendar day the occurrence fell due, YYYY-MM-DD. Date-only, so not converted --
   *  see `UpcomingBill.localDueDate`. */
  localDueDate: string;
  /** The settled outcome (PAID or SKIPPED), or SNOOZED while still outstanding */
  status: BillOccurrenceStatus;
  /** When it was settled, or the most recent snooze if it never was */
  actionDate: string | null;
  /** The user's own calendar day for `actionDate`, YYYY-MM-DD. This one *is* converted: paying
   *  a bill happens at a moment, not on a date-only field, so the same rules as a transaction's
   *  `localDate` apply. Null when the occurrence is unsettled. */
  localActionDate: string | null;
  /** Whole calendar days between the due day and the day it was paid. The due day is the
   *  stored calendar date; only the action instant is converted to the user's timezone.
   *  Negative means paid early. `null` unless the occurrence was PAID. */
  daysLate: number | null;
  /** How many times this occurrence was snoozed before being settled */
  snoozeCount: number;
  /** Whether paying it created a transaction */
  transactionId: string | null;
  snoozeUntil: string | null;
  /**
   * The user's own calendar day the snooze runs to, YYYY-MM-DD.
   *
   * Converted, unlike `localDueDate`, because its provenance is an instant and not a calendar
   * day: `POST /api/bills/[id]/action` computes it as `new Date()` plus N days off the *server*
   * clock. Someone at UTC-4 snoozing for a day at 20:00 local has that stored as the day after
   * next in UTC, so reading it as date-only would tell them the snooze runs a day longer than
   * they asked for.
   */
  localSnoozeUntil: string | null;
}

export interface BillHistorySummary {
  billId: string;
  description: string;
  categoryName: string;
  /** Scheduled occurrences in the window, not user actions. An occurrence snoozed twice and
   *  then paid counts once here, not three times. */
  occurrences: number;
  /** Counts below are by settled outcome, so they sum to `occurrences` */
  paid: number;
  skipped: number;
  /** Occurrences snoozed and still outstanding */
  snoozed: number;
  /** Total snoozes across all occurrences, which can exceed `occurrences` */
  totalSnoozes: number;
  /** Of the paid ones, how many landed on or before the due date */
  paidOnTime: number;
  paidLate: number;
  /** Averaged over paid occurrences only; skipped and snoozed have no lateness.
   *  `null` when nothing was paid. Negative means early on average. */
  avgDaysLate: number | null;
  /** Worst single lateness among paid occurrences. `null` when nothing was paid. */
  maxDaysLate: number | null;
}

export interface BillHistory {
  /** Start of the window, YYYY-MM-DD in the user's timezone */
  from: string;
  to: string;
  occurrences: BillOccurrence[];
  /** One entry per bill with history in the window, worst average lateness first */
  summaries: BillHistorySummary[];
}

// --- get_receipt_items ---

/** Covers all time when no period is given. */
export interface ReceiptItemsParams extends PeriodParams {
  /** Case-insensitive substring match on the item name */
  search?: string;
  /** Restrict to one scanned receipt, which may span several transactions */
  receiptGroupId?: string;
  /** Max items returned. Defaults to `MAX_BREAKDOWN_LINE_ITEMS`, which covers one transaction's
   *  blob but not necessarily a whole receipt: a receiptGroupId may span several transactions,
   *  each holding up to that many items. `itemCount` always reports every match, so a shorter
   *  `items` array than `itemCount` means the caller is looking at a truncated list. */
  limit?: number;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480). Month boundaries are resolved in this timezone. */
  timezoneOffset?: number;
}

export interface ReceiptItem {
  /** Item name exactly as stored by the scan */
  name: string;
  amount: number;
  /** The transaction this item was itemized under */
  transactionId: string;
  transactionDescription: string;
  transactionAmount: number;
  categoryName: string;
  /** The transaction's stored instant, ISO 8601 in UTC. */
  date: string;
  /** The same moment as the user's own calendar day, YYYY-MM-DD. */
  localDate: string;
  /** Ties together the transactions of one multi-category receipt. `null` for a receipt that
   *  produced a single transaction. */
  receiptGroupId: string | null;
  /** The total the scan recorded for this transaction's breakdown. The app displays this
   *  rather than recomputing from items, so it can disagree with both the item sum and
   *  `transactionAmount`; it is reported as stored. */
  breakdownTotal: number;
}

export interface ReceiptItems {
  /** The month filtered on, or null when unfiltered or an explicit `from`/`to` range was used */
  month: string | null;
  /** The window actually queried, or null when unfiltered. */
  period: ResolvedPeriod | null;
  /** Matching items, before `limit` was applied */
  itemCount: number;
  /** Sum of every matching item's amount, before `limit` was applied */
  totalAmount: number;
  /** True when `limit` cut the list short, so `items` is a prefix of what matched. Explicit
   *  because `itemCount` describes every match: without this a caller has to infer truncation
   *  by comparing lengths, and a caller that forgets reports a partial receipt as a whole one. */
  truncated: boolean;
  items: ReceiptItem[];
}
