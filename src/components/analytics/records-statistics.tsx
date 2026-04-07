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
import type { AnalyticsStatistics, AnalyticsTopRecord } from "@/types";

interface RecordsStatisticsProps {
  statistics: AnalyticsStatistics;
  currency: string;
  hideAmounts: boolean;
}

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function StatItem({
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
    <div className="p-3 rounded-xl bg-cream-50/50">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", iconBg)}>
          <Icon className={cn("w-4 h-4", iconColor)} />
        </div>
      </div>
      <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase mb-0.5">
        {label}
      </p>
      <p className="text-lg font-serif text-warm-700">{value}</p>
      {subtitle && <p className="text-xs text-warm-300 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function TopRecordItem({
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
  if (!record) {
    return <StatItem icon={Icon} iconColor={iconColor} iconBg={iconBg} label={label} value="—" />;
  }

  return (
    <div className="p-3 rounded-xl bg-cream-50/50">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", iconBg)}>
          <Icon className={cn("w-4 h-4", iconColor)} />
        </div>
      </div>
      <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase mb-0.5">
        {label}
      </p>
      <p className="text-lg font-serif text-warm-700">
        {hideAmounts ? `${sym} ••••••` : formatCurrency(record.amount, currency)}
      </p>
      <div className="flex items-center gap-1.5 mt-1">
        <CategoryIcon name={record.categoryIcon} className="w-3 h-3" style={{ color: record.categoryColor }} />
        <span className="text-xs text-warm-300 truncate">{record.description} · {record.date}</span>
      </div>
    </div>
  );
}

export function RecordsStatistics({ statistics: s, currency, hideAmounts }: RecordsStatisticsProps) {
  const sym = getCurrencySymbol(currency);
  const fmt = (v: number | null) =>
    v === null ? "—" : hideAmounts ? `${sym} ••••••` : formatCurrency(v, currency);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Top Records */}
      <motion.div variants={fadeUp} className="card p-5">
        <h2 className="font-serif text-lg text-warm-700">Top Records</h2>
        <p className="text-xs text-warm-300 mb-4">Notable transactions this period</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TopRecordItem icon={ArrowDownRight} iconColor="text-expense" iconBg="bg-expense-light" label="Biggest Expense" record={s.biggestExpense} currency={currency} hideAmounts={hideAmounts} />
          <TopRecordItem icon={ArrowUpRight} iconColor="text-income" iconBg="bg-income-light" label="Biggest Income" record={s.biggestIncome} currency={currency} hideAmounts={hideAmounts} />
          <StatItem
            icon={CalendarDays}
            iconColor="text-amber-600"
            iconBg="bg-amber-50"
            label="Most Expensive Day"
            value={s.mostExpensiveDay ? fmt(s.mostExpensiveDay.total) : "—"}
            subtitle={s.mostExpensiveDay ? `${s.mostExpensiveDay.date} · ${s.mostExpensiveDay.count} txns` : undefined}
          />
        </div>
      </motion.div>

      {/* Averages */}
      <motion.div variants={fadeUp} className="card p-5">
        <h2 className="font-serif text-lg text-warm-700">Averages</h2>
        <p className="text-xs text-warm-300 mb-4">Per-day and per-transaction averages</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatItem icon={Calculator} iconColor="text-expense" iconBg="bg-expense-light" label="Daily Spend" value={fmt(s.avgDailySpend)} subtitle={s.avgDailySpend !== null ? `Over ${s.totalDaysInPeriod} days` : undefined} />
          <StatItem icon={Receipt} iconColor="text-warm-500" iconBg="bg-cream-100" label="Per Expense" value={fmt(s.avgExpenseSize)} />
          <StatItem icon={Coins} iconColor="text-income" iconBg="bg-income-light" label="Per Income" value={fmt(s.avgIncomeSize)} />
        </div>
      </motion.div>

      {/* Activity */}
      <motion.div variants={fadeUp} className="card p-5">
        <h2 className="font-serif text-lg text-warm-700">Activity</h2>
        <p className="text-xs text-warm-300 mb-4">Transaction frequency and streaks</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatItem icon={Hash} iconColor="text-warm-600" iconBg="bg-cream-100" label="Transactions" value={s.totalTransactions.toLocaleString()} />
          <StatItem icon={CalendarCheck} iconColor="text-blue-500" iconBg="bg-blue-50" label="Active Days" value={`${s.activeDays} / ${s.totalDaysInPeriod}`} subtitle={s.totalDaysInPeriod > 0 ? `${Math.round((s.activeDays / s.totalDaysInPeriod) * 100)}% of days` : undefined} />
          <StatItem icon={Flame} iconColor="text-orange-500" iconBg="bg-orange-50" label="Spending Streak" value={s.spendingStreak > 0 ? `${s.spendingStreak} days` : "—"} subtitle={s.spendingStreak > 0 ? "Longest consecutive" : undefined} />
        </div>
      </motion.div>

      {/* Category Insights */}
      <motion.div variants={fadeUp} className="card p-5">
        <h2 className="font-serif text-lg text-warm-700">Category Insights</h2>
        <p className="text-xs text-warm-300 mb-4">How you use your categories</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatItem
            icon={Tag}
            iconColor="text-purple-500"
            iconBg="bg-purple-50"
            label="Most Used"
            value={s.mostUsedCategory?.name ?? "—"}
            subtitle={s.mostUsedCategory ? `${s.mostUsedCategory.count} transactions` : undefined}
          />
          <StatItem
            icon={Crown}
            iconColor="text-expense"
            iconBg="bg-expense-light"
            label="Most Expensive"
            value={s.mostExpensiveCategory ? fmt(s.mostExpensiveCategory.amount) : "—"}
            subtitle={s.mostExpensiveCategory?.name}
          />
          <StatItem icon={Layers} iconColor="text-warm-500" iconBg="bg-cream-100" label="Categories Used" value={s.categoriesUsed.toLocaleString()} />
        </div>
      </motion.div>
    </motion.div>
  );
}
