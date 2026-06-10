"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  Heart,
  Layers,
  PieChart,
  Tags,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { usePrivacy } from "@/components/privacy-provider";
import { useAnalyticsQuery, type AnalyticsParams } from "@/hooks/use-analytics";
import {
  type PeriodType,
  getCurrentMonth,
  formatPeriodLabel,
  navigatePeriod,
  chartGranularity,
} from "@/lib/analytics-period";
import { CardHeader } from "@/components/ui/card-header";
import { TimeRangePicker } from "@/components/analytics/time-range-picker";
import { TypeFilter } from "@/components/analytics/type-filter";
import { IncomeExpensesReport } from "@/components/analytics/income-expenses-report";
import { CashFlowChart } from "@/components/analytics/cash-flow-chart";
import { CategoryBreakdownChart } from "@/components/analytics/category-breakdown-chart";
import { CategoryTrendsChart } from "@/components/analytics/category-trends-chart";
import { LabelBreakdownChart } from "@/components/analytics/label-breakdown-chart";
import { SpendingHeatmap } from "@/components/analytics/spending-heatmap";
import { TopTransactions } from "@/components/analytics/top-transactions";
import { AnalyticsHero } from "@/components/analytics/analytics-hero";
import { AnalyticsSkeleton } from "@/components/analytics/analytics-skeleton";
import { RecordsStatistics } from "@/components/analytics/records-statistics";
import { FinancialHealthScore } from "@/components/analytics/financial-health-score";
import { stagger, fadeUp } from "@/components/analytics/motion-variants";
import type { AnalyticsTypeFilter } from "@/types";

type AnalyticsTab = "reports" | "statistics" | "health";

const ANALYTICS_TABS = [
  { id: "reports" as const, label: "Reports", shortLabel: "Reports", icon: BarChart3 },
  { id: "statistics" as const, label: "Records & Statistics", shortLabel: "Stats", icon: Trophy },
  { id: "health" as const, label: "Financial Health", shortLabel: "Health", icon: Heart },
];

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
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("reports");

  // Client-side label used for the picker before API data arrives
  const clientPeriodLabel = formatPeriodLabel(periodType, dateRange.from, dateRange.to);
  const granularity = chartGranularity(periodType, dateRange.from, dateRange.to);

  const params: AnalyticsParams = useMemo(() => ({
    granularity,
    from: dateRange.from,
    to: dateRange.to,
    type: typeFilter,
  }), [granularity, dateRange, typeFilter]);

  const { data, isLoading, isError, refetch } = useAnalyticsQuery(params, tz);

  // Use API-provided label once loaded (authoritative), fall back to client-derived
  const periodLabel = data?.periodLabel ?? clientPeriodLabel;

  const handlePeriodSelect = useCallback((type: PeriodType, from: string, to: string) => {
    setPeriodType(type);
    setDateRange({ from, to });
  }, []);

  const handleNavigate = useCallback((direction: "prev" | "next") => {
    setDateRange((prev) => navigatePeriod(periodType, prev.from, prev.to, direction));
  }, [periodType]);

  return (
    <div>
      {/* Page Header + Period Selector */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">Analytics</h1>
          <p className="text-warm-400 text-sm mt-1">Reports &amp; insights</p>
        </div>
        <TimeRangePicker
          periodType={periodType}
          from={dateRange.from}
          to={dateRange.to}
          label={periodLabel}
          tz={tz}
          onPeriodSelect={handlePeriodSelect}
          onNavigate={handleNavigate}
        />
      </div>

      {/* Tab Bar */}
      <div role="tablist" className="grid grid-cols-3 sm:flex gap-1 p-1 bg-cream-100 rounded-xl mb-6 sm:w-fit">
        {ANALYTICS_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-1.5 rounded-lg text-sm font-medium transition-colors",
              activeTab === tab.id ? "text-warm-700" : "text-warm-400 hover:text-warm-500"
            )}
          >
            {activeTab === tab.id && (
              <motion.span
                layoutId="analytics-tab"
                className="absolute inset-0 bg-white rounded-lg shadow-sm"
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
            <tab.icon className="relative w-4 h-4" />
            <span className="relative">
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>
            </span>
          </button>
        ))}
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
            onClick={() => refetch()}
            className="mt-2 px-4 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* Hero overview (always visible) */}
          <motion.div variants={stagger} initial="hidden" animate="show">
            <motion.div variants={fadeUp}>
              <AnalyticsHero
                summary={data.summary}
                previousSummary={data.previousSummary}
                cashFlow={data.cashFlow}
                periodLabel={data.periodLabel}
                previousPeriodLabel={data.previousPeriodLabel}
                currency={currency}
                hideAmounts={hideAmounts}
              />
            </motion.div>
          </motion.div>

          {/* Reports Tab */}
          {activeTab === "reports" && (
            <motion.div
              key="reports"
              variants={stagger}
              initial="hidden"
              animate="show"
              className="space-y-4 mt-4"
            >
              {/* Cash Flow */}
              <motion.div variants={fadeUp} className="card p-5">
                <CardHeader
                  icon={Activity}
                  title="Cash Flow"
                  subtitle="Net flow per period with cumulative trend"
                />
                <CashFlowChart data={data.cashFlow} currency={currency} hideAmounts={hideAmounts} />
              </motion.div>

              {/* Breakdowns */}
              <motion.div variants={fadeUp} className="flex items-center justify-between mb-1">
                <h2 className="font-serif text-lg text-warm-700">Breakdowns</h2>
                <TypeFilter value={typeFilter} onChange={setTypeFilter} />
              </motion.div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <motion.div variants={fadeUp} className="card p-5">
                  <CardHeader icon={PieChart} title="By Category" subtitle="Where is my money going?" />
                  <CategoryBreakdownChart data={data.categoryBreakdown} currency={currency} hideAmounts={hideAmounts} />
                </motion.div>

                <motion.div variants={fadeUp} className="card p-5">
                  <CardHeader icon={Layers} title="Category Trends" subtitle="Top spending categories over time" />
                  <CategoryTrendsChart data={data.categoryTrends} currency={currency} hideAmounts={hideAmounts} />
                </motion.div>

                <motion.div variants={fadeUp} className="card p-5">
                  <CardHeader icon={CalendarDays} title="Spending Heatmap" subtitle="Which days do you spend most?" />
                  <SpendingHeatmap data={data.daily} currency={currency} hideAmounts={hideAmounts} />
                </motion.div>

                <motion.div variants={fadeUp} className="card p-5">
                  <CardHeader icon={Trophy} title="Top Transactions" subtitle="Largest transactions this period" />
                  <TopTransactions data={data.topTransactions} currency={currency} hideAmounts={hideAmounts} />
                </motion.div>
              </div>

              {/* Label Breakdown */}
              <motion.div variants={fadeUp} className="card p-5">
                <CardHeader icon={Tags} title="By Label" subtitle="Spending by label tags" />
                <LabelBreakdownChart data={data.labelBreakdown} currency={currency} hideAmounts={hideAmounts} />
              </motion.div>

              {/* Income & Expenses Report */}
              <motion.div variants={fadeUp} className="card p-5">
                <CardHeader
                  icon={ArrowLeftRight}
                  title="Incomes & Expenses Report"
                  subtitle="Current vs previous period by category"
                />
                <IncomeExpensesReport
                  periodLabel={data.periodLabel}
                  previousPeriodLabel={data.previousPeriodLabel}
                  summary={data.summary}
                  previousSummary={data.previousSummary}
                  categoryBreakdown={data.allCategoryBreakdown}
                  previousCategoryBreakdown={data.allPreviousCategoryBreakdown}
                  currency={currency}
                  hideAmounts={hideAmounts}
                />
              </motion.div>
            </motion.div>
          )}

          {/* Records & Statistics Tab */}
          {activeTab === "statistics" && (
            <motion.div key="statistics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
              <RecordsStatistics statistics={data.statistics} currency={currency} hideAmounts={hideAmounts} />
            </motion.div>
          )}

          {/* Financial Health Tab */}
          {activeTab === "health" && (
            <motion.div key="health" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
              <FinancialHealthScore healthScore={data.healthScore} />
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
