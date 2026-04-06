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
import { AlertTriangle } from "lucide-react";
import type { AnalyticsGranularity, AnalyticsTypeFilter } from "@/types";

/** Get "now" adjusted to the user's saved timezone offset (minutes). */
const getUserNow = (tzOffset: number): Date => {
  const utcNow = new Date();
  // Shift UTC to the user's local time
  return new Date(utcNow.getTime() - tzOffset * 60 * 1000);
};

/** Compute default date range for a given granularity using the user's timezone. */
const getDefaultRange = (granularity: AnalyticsGranularity, tzOffset: number): { from: string; to: string } => {
  const now = getUserNow(tzOffset);
  // Use UTC methods since we already shifted to user-local time
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  let fromDate: Date;
  let toDate: Date;

  switch (granularity) {
    case "weekly": {
      // End on Sunday of the current week
      const todayDow = now.getUTCDay(); // 0=Sun
      const sundayOffset = todayDow === 0 ? 0 : 7 - todayDow;
      toDate = new Date(Date.UTC(y, m, d + sundayOffset));
      // Start 8 weeks before the end (Mon of that week)
      fromDate = new Date(toDate.getTime() - 8 * 7 * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
      break;
    }
    case "monthly": {
      // Last 6 months: 1st of (current - 5) to end of current month
      fromDate = new Date(Date.UTC(y, m - 5, 1));
      toDate = new Date(Date.UTC(y, m + 1, 0)); // End of current month
      break;
    }
    case "yearly": {
      // Last 3 years
      fromDate = new Date(Date.UTC(y - 2, 0, 1));
      toDate = new Date(Date.UTC(y, 11, 31));
      break;
    }
  }

  return {
    from: formatDateStr(fromDate, true),
    to: formatDateStr(toDate, true),
  };
};

/** Navigate the range forward or backward by one "page".
 *  Custom ranges always shift by their exact day span to preserve the window size. */
const navigateRange = (
  from: string,
  to: string,
  granularity: AnalyticsGranularity,
  direction: "prev" | "next",
  isCustom: boolean,
): { from: string; to: string } => {
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  const sign = direction === "next" ? 1 : -1;
  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  // Custom ranges always shift by exact day span regardless of granularity
  if (isCustom || granularity === "weekly") {
    fromDate.setDate(fromDate.getDate() + sign * spanDays);
    toDate.setDate(toDate.getDate() + sign * spanDays);
  } else if (granularity === "monthly") {
    const months = (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth()) + 1;
    fromDate.setMonth(fromDate.getMonth() + sign * months);
    toDate.setMonth(toDate.getMonth() + sign * months);
    // Fix end-of-month
    toDate.setMonth(toDate.getMonth() + 1, 0);
  } else {
    const years = toDate.getFullYear() - fromDate.getFullYear() + 1;
    fromDate.setFullYear(fromDate.getFullYear() + sign * years);
    toDate.setFullYear(toDate.getFullYear() + sign * years);
  }

  return {
    from: formatDateStr(fromDate),
    to: formatDateStr(toDate),
  };
};

const formatDateStr = (d: Date, utc = false): string => {
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const m = String((utc ? d.getUTCMonth() : d.getMonth()) + 1).padStart(2, "0");
  const day = String(utc ? d.getUTCDate() : d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Parse YYYY-MM-DD as a local date (not UTC midnight). */
const parseLocalDate = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Auto-pick granularity based on date span. */
const autoGranularity = (from: string, to: string): AnalyticsGranularity => {
  const days = (parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / (24 * 60 * 60 * 1000);
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

  const tz = user.timezoneOffset;
  const [granularity, setGranularity] = useState<AnalyticsGranularity>("monthly");
  const [isCustom, setIsCustom] = useState(false);
  const [dateRange, setDateRange] = useState(() => getDefaultRange("monthly", tz));
  const [typeFilter, setTypeFilter] = useState<AnalyticsTypeFilter>("ALL");

  const params: AnalyticsParams = useMemo(() => ({
    granularity,
    from: dateRange.from,
    to: dateRange.to,
    type: typeFilter,
  }), [granularity, dateRange, typeFilter]);

  const { data, isLoading, isError } = useAnalyticsQuery(params, tz);

  const handleGranularityChange = useCallback((g: AnalyticsGranularity) => {
    setGranularity(g);
    setIsCustom(false);
    setDateRange(getDefaultRange(g, tz));
  }, [tz]);

  const handleCustomToggle = useCallback(() => {
    setIsCustom((prev) => !prev);
  }, []);

  const handleRangeChange = useCallback((from: string, to: string) => {
    if (!from || !to) return;
    // Auto-swap inverted ranges so from <= to
    const [validFrom, validTo] = from <= to ? [from, to] : [to, from];
    setDateRange({ from: validFrom, to: validTo });
    if (isCustom) {
      setGranularity(autoGranularity(validFrom, validTo));
    }
  }, [isCustom]);

  const handleNavigate = useCallback((direction: "prev" | "next") => {
    setDateRange((prev) => navigateRange(prev.from, prev.to, granularity, direction, isCustom));
  }, [granularity, isCustom]);

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
