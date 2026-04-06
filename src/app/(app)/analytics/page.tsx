"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useUser } from "@/components/user-provider";
import { usePrivacy } from "@/components/privacy-provider";
import { useAnalyticsQuery, type AnalyticsParams } from "@/hooks/use-analytics";
import { TimeRangePicker } from "@/components/analytics/time-range-picker";
import { TypeFilter } from "@/components/analytics/type-filter";
import { IncomeExpensesReport } from "@/components/analytics/income-expenses-report";
import { CashFlowChart } from "@/components/analytics/cash-flow-chart";
import { CategoryBreakdownChart } from "@/components/analytics/category-breakdown-chart";
import { LabelBreakdownChart } from "@/components/analytics/label-breakdown-chart";
import { AnalyticsSummary } from "@/components/analytics/analytics-summary";
import { AnalyticsSkeleton } from "@/components/analytics/analytics-skeleton";
import type { AnalyticsGranularity, AnalyticsTypeFilter } from "@/types";

type PeriodType = AnalyticsGranularity | "custom";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Get current period boundaries using the user's saved timezone. */
const getCurrentMonth = (tzOffset: number): { from: string; to: string; label: string } => {
  const utcNow = new Date();
  const now = new Date(utcNow.getTime() - tzOffset * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    from: `${y}-${String(m + 1).padStart(2, "0")}-01`,
    to: `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    label: `${MONTHS[m]} ${y}`,
  };
};

/** Format period label from from/to strings. */
const formatPeriodLabel = (periodType: PeriodType, from: string, to: string): string => {
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [fY, fM, fD] = from.split("-").map(Number);
  const [tY, tM, tD] = to.split("-").map(Number);

  if (periodType === "monthly") {
    return `${MONTHS[fM - 1]} ${fY}`;
  }
  if (periodType === "yearly") {
    return `${fY}`;
  }
  if (periodType === "weekly") {
    if (fY === tY) {
      return `${MONTH_SHORT[fM - 1]} ${fD} – ${MONTH_SHORT[tM - 1]} ${tD}, ${tY}`;
    }
    return `${MONTH_SHORT[fM - 1]} ${fD}, ${fY} – ${MONTH_SHORT[tM - 1]} ${tD}, ${tY}`;
  }
  // Custom
  if (fY === tY && fM === tM && fD === 1) {
    return `${MONTHS[fM - 1]} ${fY}`;
  }
  if (fY === tY) {
    return `${MONTH_SHORT[fM - 1]} ${fD} – ${MONTH_SHORT[tM - 1]} ${tD}, ${tY}`;
  }
  return `${MONTH_SHORT[fM - 1]} ${fD}, ${fY} – ${MONTH_SHORT[tM - 1]} ${tD}, ${tY}`;
};

/** Navigate to previous/next period. */
const navigatePeriod = (
  periodType: PeriodType,
  from: string,
  to: string,
  direction: "prev" | "next",
): { from: string; to: string } => {
  const [fY, fM, fD] = from.split("-").map(Number);
  const sign = direction === "next" ? 1 : -1;

  if (periodType === "monthly") {
    const d = new Date(fY, fM - 1 + sign, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return {
      from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      to: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  if (periodType === "yearly") {
    const y = fY + sign;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  // Weekly or custom: shift by exact day span
  const fromDate = new Date(fY, fM - 1, fD);
  const [tY, tM, tD] = to.split("-").map(Number);
  const toDate = new Date(tY, tM - 1, tD);
  const span = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  fromDate.setDate(fromDate.getDate() + sign * span);
  toDate.setDate(toDate.getDate() + sign * span);

  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmtDate(fromDate), to: fmtDate(toDate) };
};

/** Map period type to internal chart granularity. */
const chartGranularity = (periodType: PeriodType, from: string, to: string): AnalyticsGranularity => {
  if (periodType === "yearly") return "monthly";
  if (periodType === "monthly") return "weekly";
  if (periodType === "weekly") return "weekly";
  // Custom: auto based on span
  const days = (new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000);
  if (days < 90) return "weekly";
  if (days < 730) return "monthly";
  return "yearly";
};

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export default function AnalyticsPage() {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const currency = user.currency;
  const tz = user.timezoneOffset;

  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [dateRange, setDateRange] = useState(() => {
    const { from, to } = getCurrentMonth(tz);
    return { from, to };
  });
  const [typeFilter, setTypeFilter] = useState<AnalyticsTypeFilter>("ALL");

  const periodLabel = formatPeriodLabel(periodType, dateRange.from, dateRange.to);
  const granularity = chartGranularity(periodType, dateRange.from, dateRange.to);

  const params: AnalyticsParams = useMemo(() => ({
    granularity,
    from: dateRange.from,
    to: dateRange.to,
    type: typeFilter,
  }), [granularity, dateRange, typeFilter]);

  const { data, isLoading, isError } = useAnalyticsQuery(params, tz);

  const handlePeriodSelect = useCallback((type: PeriodType, from: string, to: string) => {
    setPeriodType(type);
    setDateRange({ from, to });
  }, []);

  const handleNavigate = useCallback((direction: "prev" | "next") => {
    setDateRange((prev) => navigatePeriod(periodType, prev.from, prev.to, direction));
  }, [periodType]);

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">Analytics</h1>
          <p className="text-warm-400 text-sm mt-1">Reports &amp; insights</p>
        </div>
      </div>

      {/* Period Selector */}
      <div className="mb-6">
        <TimeRangePicker
          periodType={periodType}
          from={dateRange.from}
          to={dateRange.to}
          label={periodLabel}
          onPeriodSelect={handlePeriodSelect}
          onNavigate={handleNavigate}
        />
      </div>

      {isLoading ? (
        <AnalyticsSkeleton />
      ) : isError || !data ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <h3 className="font-serif text-lg text-warm-700">Failed to load analytics</h3>
          <p className="text-sm text-warm-400 max-w-sm">
            Something went wrong while fetching your data. Please try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
          >
            Reload page
          </button>
        </div>
      ) : (
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="space-y-4"
        >
          {/* Summary Cards */}
          <motion.div variants={fadeUp}>
            <AnalyticsSummary data={data.summary} currency={currency} hideAmounts={hideAmounts} />
          </motion.div>

          {/* Income & Expenses Report */}
          <motion.div variants={fadeUp} className="card p-5">
            <h2 className="font-serif text-lg text-warm-700">Incomes & Expenses Report</h2>
            <p className="text-xs text-warm-300 mb-4">Current vs previous period by category</p>
            <IncomeExpensesReport
              periodLabel={data.periodLabel}
              previousPeriodLabel={data.previousPeriodLabel}
              summary={data.summary}
              previousSummary={data.previousSummary}
              categoryBreakdown={data.categoryBreakdown}
              previousCategoryBreakdown={data.previousCategoryBreakdown}
              currency={currency}
              hideAmounts={hideAmounts}
            />
          </motion.div>

          {/* Cash Flow Chart */}
          <motion.div variants={fadeUp} className="card p-5">
            <h2 className="font-serif text-lg text-warm-700">Cash Flow</h2>
            <p className="text-xs text-warm-300 mb-4">
              Net flow per period (solid) with cumulative trend (dashed)
            </p>
            <CashFlowChart data={data.cashFlow} currency={currency} hideAmounts={hideAmounts} />
          </motion.div>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <motion.div variants={fadeUp} className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-serif text-lg text-warm-700">By Category</h2>
                  <p className="text-xs text-warm-300">Where is my money going?</p>
                </div>
                <TypeFilter value={typeFilter} onChange={setTypeFilter} />
              </div>
              <CategoryBreakdownChart data={data.categoryBreakdown} currency={currency} hideAmounts={hideAmounts} />
            </motion.div>

            <motion.div variants={fadeUp} className="card p-5">
              <h2 className="font-serif text-lg text-warm-700">By Label</h2>
              <p className="text-xs text-warm-300 mb-4">Spending by label tags</p>
              <LabelBreakdownChart data={data.labelBreakdown} currency={currency} hideAmounts={hideAmounts} />
            </motion.div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
