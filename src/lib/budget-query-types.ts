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
  /** Page number. Defaults to 1 */
  page?: number;
  /** Results per page. Defaults to 20 */
  limit?: number;
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
