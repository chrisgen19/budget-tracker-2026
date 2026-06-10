"use client";

import { useId } from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Hash, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { DeltaBadge } from "@/components/analytics/delta-badge";
import { fadeIn } from "@/components/analytics/motion-variants";
import { INCOME_COLOR, EXPENSE_COLOR } from "@/components/analytics/chart-theme";
import type { AnalyticsSummary, AnalyticsCashFlowItem } from "@/types";

interface AnalyticsHeroProps {
  summary: AnalyticsSummary;
  previousSummary: AnalyticsSummary;
  cashFlow: AnalyticsCashFlowItem[];
  periodLabel: string;
  previousPeriodLabel: string;
  currency: string;
  hideAmounts: boolean;
}

function StatRow({
  icon: Icon,
  tint,
  label,
  value,
  delta,
}: {
  icon: LucideIcon;
  tint: string;
  label: string;
  value: string;
  delta: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3 min-h-[56px] first:pt-0 last:pb-0">
      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", tint)}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">{label}</p>
        <p className="font-display font-semibold tabular-nums text-warm-700 text-sm truncate">{value}</p>
      </div>
      <div className="shrink-0">{delta}</div>
    </div>
  );
}

export function AnalyticsHero({
  summary,
  previousSummary,
  cashFlow,
  periodLabel,
  previousPeriodLabel,
  currency,
  hideAmounts,
}: AnalyticsHeroProps) {
  const uid = useId();
  const sparkId = `heroSpark${uid}`;
  const sym = getCurrencySymbol(currency);
  const fmt = (v: number) => (hideAmounts ? `${sym} ••••••` : formatCurrency(v, currency));

  const hasPrevious = previousSummary.transactionCount > 0;
  const isPositive = summary.netCashFlow >= 0;
  const sparkColor = isPositive ? INCOME_COLOR : EXPENSE_COLOR;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Net flow hero card */}
      <div className="card p-5 lg:p-6 lg:col-span-2 relative overflow-hidden flex flex-col justify-between">
        <div>
          <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">
            Net Cash Flow · {periodLabel}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-1.5">
            <span className={cn("font-serif text-3xl lg:text-4xl", isPositive ? "text-income" : "text-expense")}>
              {fmt(summary.netCashFlow)}
            </span>
            <DeltaBadge
              current={summary.netCashFlow}
              previous={previousSummary.netCashFlow}
            />
          </div>
          {hasPrevious && (
            <p className="text-xs text-warm-300 mt-1">vs {previousPeriodLabel}</p>
          )}
        </div>

        {/* Edge-bleed sparkline of net flow per bucket */}
        {cashFlow.length > 1 && (
          <motion.div
            variants={fadeIn}
            initial="hidden"
            animate="show"
            className="-mx-5 lg:-mx-6 -mb-5 lg:-mb-6 mt-4 h-14 lg:h-16"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashFlow} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={sparkId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke={sparkColor}
                  strokeWidth={2}
                  fill={`url(#${sparkId})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </div>

      {/* Secondary stats */}
      <div className="card p-5 divide-y divide-cream-100">
        <StatRow
          icon={TrendingUp}
          tint="bg-income-light text-income"
          label="Income"
          value={fmt(summary.totalIncome)}
          delta={
            <DeltaBadge
              current={summary.totalIncome}
              previous={previousSummary.totalIncome}
            />
          }
        />
        <StatRow
          icon={TrendingDown}
          tint="bg-expense-light text-expense"
          label="Expenses"
          value={fmt(summary.totalExpenses)}
          delta={
            <DeltaBadge
              current={summary.totalExpenses}
              previous={previousSummary.totalExpenses}
              invert
            />
          }
        />
        <StatRow
          icon={Hash}
          tint="bg-cream-100 text-warm-500"
          label="Transactions"
          value={summary.transactionCount.toLocaleString()}
          delta={
            <DeltaBadge
              current={summary.transactionCount}
              previous={previousSummary.transactionCount}
              neutral
            />
          }
        />
      </div>
    </div>
  );
}
