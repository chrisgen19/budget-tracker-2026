import type { Category, Transaction, TransactionType, UserRole } from "@prisma/client";

export type { Category, Transaction, TransactionType, UserRole };

/** Transaction with its category relation */
export type TransactionWithCategory = Transaction & {
  category: Category;
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
  };
  error?: string;
  /** Compressed image kept in memory for breakdown requests */
  imageFile?: File;
  /** Set on breakdown children — prevents re-breakdown, enables "Itemized" badge */
  parentId?: string;
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
