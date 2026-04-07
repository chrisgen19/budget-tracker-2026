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
};

/** Transaction with its category (and optional bill) relation */
export type TransactionWithCategory = Transaction & {
  category: Category;
  bill?: ScheduledTransaction | null;
  labels?: (TransactionLabel & { label: Label })[];
};

/** Label with transaction count */
export type LabelWithCount = Label & {
  _count: { transactions: number };
};

/** Label with transaction count and schedules */
export type LabelWithCountAndSchedules = Label & {
  _count: { transactions: number };
  schedules: LabelSchedule[];
};

/** Dashboard summary stats */
export interface DashboardStats {
  totalIncome: number;
  totalExpenses: number;
  balance: number;        // monthly net (selected month only)
  runningBalance: number; // cumulative all-time net up to end of selected month
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
    receiptGroupId?: string;
    receiptBreakdown?: ReceiptBreakdownMeta;
    /** Whether the receipt has items spanning 2+ spending categories */
    multiCategory?: boolean;
    /** Pre-loaded breakdown from combined scan (avoids second Gemini call) */
    breakdown?: Array<{
      amount: number;
      categoryId: string;
      description: string;
      lineItems: Array<{ name: string; amount: number }>;
    }>;
    /** True when the receipt date year differs from the current year (possible POS error) */
    dateWarning?: boolean;
  };
  error?: string;
  /** Compressed image kept in memory for breakdown requests */
  imageFile?: File;
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
  totalDaysInPeriod: number;
  spendingStreak: number;
  mostUsedCategory: { name: string; icon: string; color: string; count: number } | null;
  mostExpensiveCategory: { name: string; icon: string; color: string; amount: number } | null;
  categoriesUsed: number;
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
}

/** Extend next-auth types */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}
