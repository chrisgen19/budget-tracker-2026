import type { TransactionType } from "@prisma/client";
import type { AnalyticsCategoryItem, MonthlyTrendItem } from "@/types";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface CategoryBreakdownRow {
  categoryId: string;
  type: TransactionType;
  amount: number;
  category: { name: string; color: string; icon: string };
}

/** Expense totals per category for the selected month, largest first, with the ids a drill-down needs. */
export const buildCategoryBreakdown = (
  rows: CategoryBreakdownRow[],
  totalExpenses: number
): AnalyticsCategoryItem[] => {
  const map = new Map<string, AnalyticsCategoryItem>();

  for (const t of rows) {
    if (t.type !== "EXPENSE") continue;
    const existing = map.get(t.categoryId);
    if (existing) {
      existing.amount += t.amount;
      existing.transactionCount += 1;
    } else {
      map.set(t.categoryId, {
        id: t.categoryId,
        name: t.category.name,
        color: t.category.color,
        icon: t.category.icon,
        type: "EXPENSE",
        amount: t.amount,
        percentage: 0,
        transactionCount: 1,
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({
      ...item,
      percentage: totalExpenses > 0 ? Math.round((item.amount / totalExpenses) * 100) : 0,
    }));
};

export interface MonthlyTrendRow {
  type: TransactionType;
  amount: number;
  date: Date;
}

/** The last six months ending at `localNow`, oldest first. */
export const buildMonthlyTrend = (
  rows: MonthlyTrendRow[],
  localNow: Date,
  toLocalMonthKey: (d: Date) => string
): MonthlyTrendItem[] => {
  const trend: MonthlyTrendItem[] = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() - i, 1));
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthRows = rows.filter((t) => toLocalMonthKey(new Date(t.date)) === monthKey);

    trend.push({
      month: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      monthKey,
      income: monthRows.filter((t) => t.type === "INCOME").reduce((sum, t) => sum + t.amount, 0),
      expenses: monthRows.filter((t) => t.type === "EXPENSE").reduce((sum, t) => sum + t.amount, 0),
      transactionCount: monthRows.length,
    });
  }

  return trend;
};
