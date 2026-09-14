"use client";

import {
  ArrowDownUp,
  CalendarDays,
  CircleDollarSign,
  Info,
  Percent,
} from "lucide-react";
import { motion } from "framer-motion";
import { maskCurrency } from "@/lib/utils";
import { stagger, fadeUp } from "@/components/analytics/motion-variants";
import type { AnalyticsCashFlowSignals, AnalyticsComparisonStatus } from "@/types";

interface CashFlowSignalsProps {
  signals: AnalyticsCashFlowSignals;
  previousPeriodLabel: string;
  currency: string;
  hideAmounts: boolean;
  comparisonStatus: AnalyticsComparisonStatus;
}

interface SignalCardProps {
  icon: typeof Percent;
  label: string;
  value: string;
  detail: string;
}

const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

const formatChange = (value: number | null): string => {
  if (value === null) return "—";
  const percentage = Math.round(value * 100);
  return `${percentage > 0 ? "+" : ""}${percentage}%`;
};

const formatPointChange = (value: number | null): string => {
  if (value === null) return "No comparable income rate";
  const points = Math.round(value * 100);
  return `${points > 0 ? "+" : ""}${points} percentage points`;
};

function SignalCard({ icon: Icon, label, value, detail }: SignalCardProps) {
  return (
    <div className="rounded-xl bg-cream-50/60 p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-light/60">
        <Icon className="h-4 w-4 text-amber-dark" aria-hidden="true" />
      </div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-warm-400">{label}</p>
      <p className="mt-0.5 font-serif text-xl text-warm-700">{value}</p>
      <p className="mt-1 text-xs text-warm-400">{detail}</p>
    </div>
  );
}

export function CashFlowSignals({
  signals,
  previousPeriodLabel,
  currency,
  hideAmounts,
  comparisonStatus,
}: CashFlowSignalsProps) {
  const comparisonDetail = signals.hasComparableData
    ? `Compared with ${previousPeriodLabel}`
    : comparisonStatus === "low-coverage"
      ? "Comparison hidden because coverage is low"
      : comparisonStatus === "not-started"
        ? "This period has not started"
        : `No transactions in ${previousPeriodLabel}`;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <motion.section variants={fadeUp} className="card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-light/60">
            <CircleDollarSign className="h-5 w-5 text-amber-dark" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-serif text-lg text-warm-700">Cash Flow Signals</h2>
            <p className="mt-1 text-sm text-warm-400">
              Descriptive signals from your logged transactions, not a financial health rating.
            </p>
            <p className="mt-3 text-[10px] font-medium uppercase tracking-wider text-warm-400">
              Net cash flow
            </p>
            <p className="font-serif text-2xl text-warm-700">
              {maskCurrency(signals.netCashFlow, currency, hideAmounts)}
            </p>
          </div>
        </div>
      </motion.section>

      <motion.section variants={fadeUp} className="card p-4 sm:p-5">
        <h2 className="font-serif text-lg text-warm-700">Selected-period signals</h2>
        <p className="mb-4 text-xs text-warm-300">{comparisonDetail}</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SignalCard
            icon={Percent}
            label="Income kept"
            value={formatPercent(signals.savingsRate)}
            detail={formatPointChange(signals.savingsRateChange)}
          />
          <SignalCard
            icon={ArrowDownUp}
            label="Expense change"
            value={formatChange(signals.expenseChange)}
            detail={comparisonDetail}
          />
          <SignalCard
            icon={ArrowDownUp}
            label="Income change"
            value={formatChange(signals.incomeChange)}
            detail={comparisonDetail}
          />
          <SignalCard
            icon={CalendarDays}
            label="Expense days"
            value={`${signals.expenseDays} / ${signals.totalDaysInPeriod}`}
            detail="Days with a logged expense"
          />
        </div>
      </motion.section>

      <motion.aside variants={fadeUp} className="card flex gap-3 p-4 sm:p-5">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-warm-400" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-medium text-warm-700">What these signals do not measure</h2>
          <p className="mt-1 text-xs leading-relaxed text-warm-400">
            Account balances, liquid savings, assets, debt, goals, insurance, and other parts of
            financial wellbeing are not in this transaction view. Use these figures as cash-flow
            context, not a complete judgment of your finances.
          </p>
        </div>
      </motion.aside>
    </motion.div>
  );
}
