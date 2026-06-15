"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Calculator,
  Receipt,
  Coins,
  Hash,
  CalendarCheck,
  Flame,
  Tag,
  Crown,
  Layers,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { stagger, fadeUp } from "@/components/analytics/motion-variants";
import type { AnalyticsStatistics, AnalyticsTopRecord } from "@/types";

interface RecordsStatisticsProps {
  statistics: AnalyticsStatistics;
  currency: string;
  hideAmounts: boolean;
}

/** Prominent tile for a notable transaction record (Biggest Expense / Income). */
function FeaturedRecord({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  record,
  currency,
  hideAmounts,
}: {
  icon: typeof Hash;
  iconColor: string;
  iconBg: string;
  label: string;
  record: AnalyticsTopRecord | null;
  currency: string;
  hideAmounts: boolean;
}) {
  const sym = getCurrencySymbol(currency);
  return (
    <div className="p-3.5 rounded-xl bg-cream-50/60 border border-cream-200/60">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", iconBg)}>
          <Icon className={cn("w-4 h-4", iconColor)} />
        </div>
        <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase truncate">
          {label}
        </p>
      </div>
      <p className="text-xl font-serif text-warm-700 truncate tabular-nums">
        {record ? (hideAmounts ? `${sym} ••••••` : formatCurrency(record.amount, currency)) : "—"}
      </p>
      {record && (
        <div className="flex items-center gap-1.5 mt-1 min-w-0">
          <CategoryIcon name={record.categoryIcon} className="w-3 h-3 shrink-0" style={{ color: record.categoryColor }} />
          <span className="text-xs text-warm-300 truncate">{record.description} · {record.date}</span>
        </div>
      )}
    </div>
  );
}

/** Scannable list row: icon + label on the left, value (+ subtitle) on the right. */
function MetricRow({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  subtitle,
}: {
  icon: typeof Hash;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", iconBg)}>
        <Icon className={cn("w-4 h-4", iconColor)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-warm-600 truncate">{label}</p>
        {subtitle && <p className="text-xs text-warm-300 truncate">{subtitle}</p>}
      </div>
      <p className="text-base font-serif text-warm-700 shrink-0 max-w-[45%] truncate text-right tabular-nums">
        {value}
      </p>
    </div>
  );
}

export function RecordsStatistics({ statistics: s, currency, hideAmounts }: RecordsStatisticsProps) {
  const sym = getCurrencySymbol(currency);
  const fmt = (v: number | null) =>
    v === null ? "—" : hideAmounts ? `${sym} ••••••` : formatCurrency(v, currency);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Top Records — featured tiles + priciest-day banner */}
      <motion.div variants={fadeUp} className="card p-4 sm:p-5">
        <h2 className="font-serif text-lg text-warm-700">Top Records</h2>
        <p className="text-xs text-warm-300 mb-3">Notable transactions this period</p>
        <div className="grid grid-cols-2 gap-3">
          <FeaturedRecord icon={ArrowDownRight} iconColor="text-expense" iconBg="bg-expense-light" label="Biggest Expense" record={s.biggestExpense} currency={currency} hideAmounts={hideAmounts} />
          <FeaturedRecord icon={ArrowUpRight} iconColor="text-income" iconBg="bg-income-light" label="Biggest Income" record={s.biggestIncome} currency={currency} hideAmounts={hideAmounts} />
        </div>
        <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-amber-50/70">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4 text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warm-600">Most Expensive Day</p>
            {s.mostExpensiveDay && (
              <p className="text-xs text-warm-300 truncate">{s.mostExpensiveDay.date} · {s.mostExpensiveDay.count} txns</p>
            )}
          </div>
          <p className="text-base font-serif text-warm-700 shrink-0 tabular-nums">
            {s.mostExpensiveDay ? fmt(s.mostExpensiveDay.total) : "—"}
          </p>
        </div>
      </motion.div>

      {/* Averages */}
      <motion.div variants={fadeUp} className="card p-4 sm:p-5">
        <h2 className="font-serif text-lg text-warm-700">Averages</h2>
        <p className="text-xs text-warm-300 mb-1">Per-day and per-transaction averages</p>
        <div className="divide-y divide-cream-200/70">
          <MetricRow icon={Calculator} iconColor="text-expense" iconBg="bg-expense-light" label="Daily Spend" value={fmt(s.avgDailySpend)} subtitle={s.avgDailySpend !== null ? `Over ${s.totalDaysInPeriod} days` : undefined} />
          <MetricRow icon={Receipt} iconColor="text-warm-500" iconBg="bg-cream-100" label="Per Expense" value={fmt(s.avgExpenseSize)} />
          <MetricRow icon={Coins} iconColor="text-income" iconBg="bg-income-light" label="Per Income" value={fmt(s.avgIncomeSize)} />
        </div>
      </motion.div>

      {/* Activity */}
      <motion.div variants={fadeUp} className="card p-4 sm:p-5">
        <h2 className="font-serif text-lg text-warm-700">Activity</h2>
        <p className="text-xs text-warm-300 mb-1">Transaction frequency and streaks</p>
        <div className="divide-y divide-cream-200/70">
          <MetricRow icon={Hash} iconColor="text-warm-600" iconBg="bg-cream-100" label="Transactions" value={s.totalTransactions.toLocaleString()} />
          <MetricRow icon={CalendarCheck} iconColor="text-blue-500" iconBg="bg-blue-50" label="Active Days" value={`${s.activeDays} / ${s.totalDaysInPeriod}`} subtitle={s.totalDaysInPeriod > 0 ? `${Math.round((s.activeDays / s.totalDaysInPeriod) * 100)}% of days` : undefined} />
          <MetricRow icon={Flame} iconColor="text-orange-500" iconBg="bg-orange-50" label="Spending Streak" value={s.spendingStreak > 0 ? `${s.spendingStreak} days` : "—"} subtitle={s.spendingStreak > 0 ? "Longest consecutive" : undefined} />
        </div>
      </motion.div>

      {/* Category Insights */}
      <motion.div variants={fadeUp} className="card p-4 sm:p-5">
        <h2 className="font-serif text-lg text-warm-700">Category Insights</h2>
        <p className="text-xs text-warm-300 mb-1">How you use your categories</p>
        <div className="divide-y divide-cream-200/70">
          <MetricRow icon={Tag} iconColor="text-purple-500" iconBg="bg-purple-50" label="Most Used" value={s.mostUsedCategory?.name ?? "—"} subtitle={s.mostUsedCategory ? `${s.mostUsedCategory.count} transactions` : undefined} />
          <MetricRow icon={Crown} iconColor="text-expense" iconBg="bg-expense-light" label="Most Expensive" value={s.mostExpensiveCategory ? fmt(s.mostExpensiveCategory.amount) : "—"} subtitle={s.mostExpensiveCategory?.name} />
          <MetricRow icon={Layers} iconColor="text-warm-500" iconBg="bg-cream-100" label="Categories Used" value={s.categoriesUsed.toLocaleString()} />
        </div>
      </motion.div>
    </motion.div>
  );
}
