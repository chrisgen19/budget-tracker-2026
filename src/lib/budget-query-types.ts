import type { PrismaClient } from "@prisma/client";

// Re-export PrismaClient type for convenience
export type { PrismaClient };

// Common filter types
export type TransactionType = "INCOME" | "EXPENSE";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

// --- get_spending_by_category ---

export interface SpendingByCategoryParams {
  /** Format: YYYY-MM. Defaults to current month */
  month?: string;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Month boundaries are resolved in this
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

export interface TopExpensesParams {
  /** Number of results to return. Defaults to 10 */
  limit?: number;
  /** Format: YYYY-MM. If omitted, returns all-time */
  month?: string;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Month boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface TopExpense {
  id: string;
  amount: number;
  description: string;
  date: string;
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

export interface SearchTransactionsParams {
  /** Search term for description (case-insensitive) */
  search?: string;
  /** Filter by type */
  type?: TransactionType;
  /** Filter by category ID */
  categoryId?: string;
  /** Format: YYYY-MM */
  month?: string;
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
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Month boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface SearchTransactionsResult {
  transactions: Array<{
    id: string;
    amount: number;
    description: string;
    type: TransactionType;
    date: string;
    categoryName: string;
    categoryIcon: string;
    categoryColor: string;
    labels: Array<{ id: string; name: string; color: string }>;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// --- get_budget_overview ---

export interface BudgetOverviewParams {
  /** Format: YYYY-MM. Defaults to current month */
  month?: string;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Month boundaries are resolved in this
   *  timezone. Omit to fall back to UTC. */
  timezoneOffset?: number;
}

export interface BudgetOverview {
  month: string;
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
  dueDate: string;
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

export interface LabelBreakdownParams {
  /** Format: YYYY-MM. Defaults to current month */
  month?: string;
  /** Restrict to one transaction type. Defaults to EXPENSE */
  type?: TransactionType;
  /** User's timezone offset in minutes (`getTimezoneOffset()` convention, so UTC+8 is
   *  -480), matching `users.timezone_offset`. Month boundaries are resolved in this
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
  month: string;
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
  /** The date this occurrence was due */
  dueDate: string;
  /** The settled outcome (PAID or SKIPPED), or SNOOZED while still outstanding */
  status: BillOccurrenceStatus;
  /** When it was settled, or the most recent snooze if it never was */
  actionDate: string | null;
  /** Whole calendar days between the due day and the day it was paid. The due day is the
   *  stored calendar date; only the action instant is converted to the user's timezone.
   *  Negative means paid early. `null` unless the occurrence was PAID. */
  daysLate: number | null;
  /** How many times this occurrence was snoozed before being settled */
  snoozeCount: number;
  /** Whether paying it created a transaction */
  transactionId: string | null;
  snoozeUntil: string | null;
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

export interface ReceiptItemsParams {
  /** Format: YYYY-MM. Omit for all time */
  month?: string;
  /** Case-insensitive substring match on the item name */
  search?: string;
  /** Restrict to one scanned receipt, which may span several transactions */
  receiptGroupId?: string;
  /** Max items returned. Defaults to 100 */
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
  /** ISO date of the transaction */
  date: string;
  /** Ties together the transactions of one multi-category receipt. `null` for a receipt that
   *  produced a single transaction. */
  receiptGroupId: string | null;
  /** The total the scan recorded for this transaction's breakdown. The app displays this
   *  rather than recomputing from items, so it can disagree with both the item sum and
   *  `transactionAmount`; it is reported as stored. */
  breakdownTotal: number;
}

export interface ReceiptItems {
  /** The month filtered on, or null when unfiltered */
  month: string | null;
  /** Matching items, before `limit` was applied */
  itemCount: number;
  /** Sum of every matching item's amount, before `limit` was applied */
  totalAmount: number;
  items: ReceiptItem[];
}
