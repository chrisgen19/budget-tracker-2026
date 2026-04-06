"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { useUser } from "@/components/user-provider";
import { usePrivacy } from "@/components/privacy-provider";
import { useAnalyticsQuery, type AnalyticsParams } from "@/hooks/use-analytics";
import { TimeRangePicker } from "@/components/analytics/time-range-picker";
import { TypeFilter } from "@/components/analytics/type-filter";
import { IncomeExpensesChart } from "@/components/analytics/income-expenses-chart";
import { CashFlowChart } from "@/components/analytics/cash-flow-chart";
import { CategoryBreakdownChart } from "@/components/analytics/category-breakdown-chart";
import { LabelBreakdownChart } from "@/components/analytics/label-breakdown-chart";
import { AnalyticsSummary } from "@/components/analytics/analytics-summary";
import { AnalyticsSkeleton } from "@/components/analytics/analytics-skeleton";
import type { AnalyticsGranularity, AnalyticsTypeFilter } from "@/types";

/** Compute default date range for a given granularity. */
const getDefaultRange = (granularity: AnalyticsGranularity): { from: string; to: string } => {
  const now = new Date();
  const toDate = new Date(now);
  let fromDate: Date;

  switch (granularity) {
    case "weekly": {
      // Last 8 weeks
      fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 8 * 7);
      // Align to Monday
      const day = fromDate.getDay();
      fromDate.setDate(fromDate.getDate() - (day === 0 ? 6 : day - 1));
      // End on Sunday
      const endDay = toDate.getDay();
      toDate.setDate(toDate.getDate() + (endDay === 0 ? 0 : 7 - endDay));
      break;
    }
    case "monthly": {
      // Last 6 months
      fromDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      toDate.setMonth(toDate.getMonth() + 1, 0); // End of current month
      break;
    }
    case "yearly": {
      // Last 3 years
      fromDate = new Date(now.getFullYear() - 2, 0, 1);
      toDate.setFullYear(toDate.getFullYear(), 11, 31);
      break;
    }
  }

  return {
    from: formatDateStr(fromDate),
    to: formatDateStr(toDate),
  };
};

/** Navigate the range forward or backward by one "page". */
const navigateRange = (
  from: string,
  to: string,
  granularity: AnalyticsGranularity,
  direction: "prev" | "next"
): { from: string; to: string } => {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const sign = direction === "next" ? 1 : -1;

  switch (granularity) {
    case "weekly": {
      const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      fromDate.setDate(fromDate.getDate() + sign * spanDays);
      toDate.setDate(toDate.getDate() + sign * spanDays);
      break;
    }
    case "monthly": {
      const months = (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth()) + 1;
      fromDate.setMonth(fromDate.getMonth() + sign * months);
      toDate.setMonth(toDate.getMonth() + sign * months);
      // Fix end-of-month
      toDate.setMonth(toDate.getMonth() + 1, 0);
      break;
    }
    case "yearly": {
      const years = toDate.getFullYear() - fromDate.getFullYear() + 1;
      fromDate.setFullYear(fromDate.getFullYear() + sign * years);
      toDate.setFullYear(toDate.getFullYear() + sign * years);
      break;
    }
  }

  return {
    from: formatDateStr(fromDate),
    to: formatDateStr(toDate),
  };
};

const formatDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Auto-pick granularity based on date span. */
const autoGranularity = (from: string, to: string): AnalyticsGranularity => {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000);
  if (days < 90) return "weekly";
  if (days < 730) return "monthly";
  return "yearly";
};

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export default function AnalyticsPage() {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const currency = user.currency;

  const [granularity, setGranularity] = useState<AnalyticsGranularity>("monthly");
  const [isCustom, setIsCustom] = useState(false);
  const [dateRange, setDateRange] = useState(() => getDefaultRange("monthly"));
  const [typeFilter, setTypeFilter] = useState<AnalyticsTypeFilter>("ALL");

  const params: AnalyticsParams = useMemo(() => ({
    granularity,
    from: dateRange.from,
    to: dateRange.to,
    type: typeFilter,
  }), [granularity, dateRange, typeFilter]);

  const { data, isLoading } = useAnalyticsQuery(params, user.timezoneOffset);

  const handleGranularityChange = useCallback((g: AnalyticsGranularity) => {
    setGranularity(g);
    setIsCustom(false);
    setDateRange(getDefaultRange(g));
  }, []);

  const handleCustomToggle = useCallback(() => {
    setIsCustom((prev) => !prev);
  }, []);

  const handleRangeChange = useCallback((from: string, to: string) => {
    if (!from || !to) return;
    setDateRange({ from, to });
    if (isCustom) {
      setGranularity(autoGranularity(from, to));
    }
  }, [isCustom]);

  const handleNavigate = useCallback((direction: "prev" | "next") => {
    setDateRange((prev) => navigateRange(prev.from, prev.to, granularity, direction));
  }, [granularity]);

  return (
    <div className="max-w-4xl mx-auto px-4 pt-6 pb-28 sm:pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="font-serif text-2xl text-warm-800">Analytics</h1>
          <p className="text-xs text-warm-400">Reports &amp; insights</p>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-4 mb-6">
        <TimeRangePicker
          granularity={granularity}
          from={dateRange.from}
          to={dateRange.to}
          isCustom={isCustom}
          onGranularityChange={handleGranularityChange}
          onCustomToggle={handleCustomToggle}
          onRangeChange={handleRangeChange}
          onNavigate={handleNavigate}
        />
        <TypeFilter value={typeFilter} onChange={setTypeFilter} />
      </div>

      {isLoading || !data ? (
        <AnalyticsSkeleton />
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

          {/* Income & Expenses Chart */}
          <motion.div variants={fadeUp} className="card p-5">
            <h2 className="font-serif text-lg text-warm-700">Income & Expenses</h2>
            <p className="text-xs text-warm-300 mb-4">How much am I earning vs spending?</p>
            <IncomeExpensesChart data={data.incomeExpenses} currency={currency} hideAmounts={hideAmounts} />
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
              <h2 className="font-serif text-lg text-warm-700">By Category</h2>
              <p className="text-xs text-warm-300 mb-4">Where is my money going?</p>
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
