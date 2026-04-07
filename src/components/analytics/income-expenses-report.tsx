"use client";

import type { AnalyticsCategoryItem, AnalyticsSummary } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";

interface IncomeExpensesReportProps {
  periodLabel: string;
  previousPeriodLabel: string;
  summary: AnalyticsSummary;
  previousSummary: AnalyticsSummary;
  categoryBreakdown: AnalyticsCategoryItem[];
  previousCategoryBreakdown: AnalyticsCategoryItem[];
  currency: string;
  hideAmounts: boolean;
}

export function IncomeExpensesReport({
  periodLabel,
  previousPeriodLabel,
  summary,
  previousSummary,
  categoryBreakdown,
  previousCategoryBreakdown,
  currency,
  hideAmounts,
}: IncomeExpensesReportProps) {
  const sym = getCurrencySymbol(currency);
  const fmt = (amount: number) => (hideAmounts ? `${sym} ••••••` : formatCurrency(amount, currency));

  // Build a map of previous period amounts by category ID
  const prevMap = new Map(previousCategoryBreakdown.map((c) => [c.id, c.amount]));

  // Split current categories by type
  const incomeCategories = categoryBreakdown.filter((c) => c.type === "INCOME");
  const expenseCategories = categoryBreakdown.filter((c) => c.type === "EXPENSE");

  // Also collect categories that only exist in previous period
  const currentIds = new Set(categoryBreakdown.map((c) => c.id));
  const prevOnlyIncome = previousCategoryBreakdown.filter((c) => c.type === "INCOME" && !currentIds.has(c.id));
  const prevOnlyExpense = previousCategoryBreakdown.filter((c) => c.type === "EXPENSE" && !currentIds.has(c.id));

  return (
    <div className="space-y-0">
      {/* Column headers */}
      <div className="flex items-end justify-end gap-0 mb-1 px-1">
        <span className="w-28 sm:w-36 text-right text-xs font-medium text-warm-500 truncate">
          {periodLabel}
        </span>
        <span className="w-28 sm:w-36 text-right text-xs font-medium text-warm-400 truncate">
          {previousPeriodLabel}
        </span>
      </div>

      {/* Income Section */}
      <div className="mb-4">
        <div className="flex items-center py-3 px-1 border-l-[3px] border-income bg-income-light/30 rounded-r-lg">
          <span className="flex-1 text-sm font-semibold text-warm-800 pl-3">Total Income</span>
          <span className="w-28 sm:w-36 text-right text-sm font-semibold text-income tabular-nums">
            {fmt(summary.totalIncome)}
          </span>
          <span className="w-28 sm:w-36 text-right text-sm font-medium text-warm-400 tabular-nums">
            {fmt(previousSummary.totalIncome)}
          </span>
        </div>

        {incomeCategories.map((cat) => (
          <CategoryRow
            key={cat.id}
            icon={cat.icon}
            color={cat.color}
            name={cat.name}
            amount={cat.amount}
            prevAmount={prevMap.get(cat.id) ?? 0}
            fmt={fmt}
          />
        ))}
        {prevOnlyIncome.map((cat) => (
          <CategoryRow
            key={cat.id}
            icon={cat.icon}
            color={cat.color}
            name={cat.name}
            amount={0}
            prevAmount={cat.amount}
            fmt={fmt}
          />
        ))}
        {incomeCategories.length === 0 && prevOnlyIncome.length === 0 && (
          <div className="py-3 px-4 text-xs text-warm-300 italic">No income in this period</div>
        )}
      </div>

      {/* Expense Section */}
      <div>
        <div className="flex items-center py-3 px-1 border-l-[3px] border-expense bg-expense-light/30 rounded-r-lg">
          <span className="flex-1 text-sm font-semibold text-warm-800 pl-3">Total Expense</span>
          <span className="w-28 sm:w-36 text-right text-sm font-semibold text-expense tabular-nums">
            {summary.totalExpenses > 0 ? `-${fmt(summary.totalExpenses)}` : fmt(0)}
          </span>
          <span className="w-28 sm:w-36 text-right text-sm font-medium text-warm-400 tabular-nums">
            {previousSummary.totalExpenses > 0 ? `-${fmt(previousSummary.totalExpenses)}` : fmt(0)}
          </span>
        </div>

        {expenseCategories.map((cat) => (
          <CategoryRow
            key={cat.id}
            icon={cat.icon}
            color={cat.color}
            name={cat.name}
            amount={cat.amount}
            prevAmount={prevMap.get(cat.id) ?? 0}
            fmt={fmt}
            isExpense
          />
        ))}
        {prevOnlyExpense.map((cat) => (
          <CategoryRow
            key={cat.id}
            icon={cat.icon}
            color={cat.color}
            name={cat.name}
            amount={0}
            prevAmount={cat.amount}
            fmt={fmt}
            isExpense
          />
        ))}
        {expenseCategories.length === 0 && prevOnlyExpense.length === 0 && (
          <div className="py-3 px-4 text-xs text-warm-300 italic">No expenses in this period</div>
        )}
      </div>
    </div>
  );
}

function CategoryRow({
  icon,
  color,
  name,
  amount,
  prevAmount,
  fmt,
  isExpense = false,
}: {
  icon: string;
  color: string;
  name: string;
  amount: number;
  prevAmount: number;
  fmt: (n: number) => string;
  isExpense?: boolean;
}) {
  const displayAmount = isExpense && amount > 0 ? `-${fmt(amount)}` : fmt(amount);
  const displayPrev = isExpense && prevAmount > 0 ? `-${fmt(prevAmount)}` : fmt(prevAmount);

  return (
    <div className="flex items-center py-2.5 px-1 border-b border-cream-100 last:border-0">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ml-2"
        style={{ backgroundColor: color + "1A" }}
      >
        <CategoryIcon name={icon} className="w-3.5 h-3.5" style={{ color }} />
      </div>
      <span className="flex-1 text-sm text-warm-600 ml-3 truncate">{name}</span>
      <span className="w-28 sm:w-36 text-right text-sm text-warm-700 tabular-nums font-medium">
        {displayAmount}
      </span>
      <span className="w-28 sm:w-36 text-right text-sm text-warm-400 tabular-nums">
        {displayPrev}
      </span>
    </div>
  );
}
