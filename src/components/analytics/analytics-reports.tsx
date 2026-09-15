"use client";

import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeftRight,
  CalendarDays,
  Layers,
  PieChart,
  Tags,
  Trophy,
} from "lucide-react";
import { CardHeader } from "@/components/ui/card-header";
import { CashFlowChart } from "@/components/analytics/cash-flow-chart";
import { CategoryBreakdownChart } from "@/components/analytics/category-breakdown-chart";
import { CategoryTrendsChart } from "@/components/analytics/category-trends-chart";
import { IncomeExpensesReport } from "@/components/analytics/income-expenses-report";
import { LabelBreakdownChart } from "@/components/analytics/label-breakdown-chart";
import { SpendingHeatmap } from "@/components/analytics/spending-heatmap";
import { TopTransactions } from "@/components/analytics/top-transactions";
import { TypeFilter } from "@/components/analytics/type-filter";
import { fadeUp, stagger } from "@/components/analytics/motion-variants";
import type { AnalyticsData, AnalyticsTypeFilter } from "@/types";

interface AnalyticsReportsProps {
  data: AnalyticsData;
  currency: string;
  hideAmounts: boolean;
  dateRange: { from: string; to: string };
  returnTo: string;
  typeFilter: AnalyticsTypeFilter;
  onTypeFilterChange: (type: AnalyticsTypeFilter) => void;
}

export function AnalyticsReports({
  data,
  currency,
  hideAmounts,
  dateRange,
  returnTo,
  typeFilter,
  onTypeFilterChange,
}: AnalyticsReportsProps) {
  return (
    <motion.div key="reports" variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="card p-5">
        <CardHeader icon={Activity} title="Cash Flow" subtitle="All income and expenses across the selected period" />
        <CashFlowChart data={data.cashFlow} currency={currency} hideAmounts={hideAmounts} />
      </motion.div>

      <section aria-labelledby="transaction-breakdowns-heading" className="space-y-4">
        <motion.div variants={fadeUp} className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="transaction-breakdowns-heading" className="font-serif text-lg text-warm-700">
              Transaction breakdowns
            </h2>
            <p className="mt-1 text-xs text-warm-400">
              The type filter applies to category, label, and top transactions only.
            </p>
          </div>
          <TypeFilter value={typeFilter} onChange={onTypeFilterChange} />
        </motion.div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <motion.div variants={fadeUp} className="card p-5">
            <CardHeader icon={PieChart} title="By Category" subtitle="Transactions grouped by category" />
            <CategoryBreakdownChart data={data.categoryBreakdown} currency={currency} hideAmounts={hideAmounts} range={dateRange} returnTo={returnTo} />
          </motion.div>
          <motion.div variants={fadeUp} className="card p-5">
            <CardHeader icon={Trophy} title="Top Transactions" subtitle="Largest matching transactions this period" />
            <TopTransactions data={data.topTransactions} currency={currency} hideAmounts={hideAmounts} />
          </motion.div>
        </div>

        <motion.div variants={fadeUp} className="card p-5">
          <CardHeader icon={Tags} title="By Label" subtitle="Matching transactions grouped by label" />
          <LabelBreakdownChart data={data.labelBreakdown} currency={currency} hideAmounts={hideAmounts} range={dateRange} type={typeFilter} returnTo={returnTo} />
        </motion.div>
      </section>

      <section aria-labelledby="expense-patterns-heading" className="space-y-4">
        <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="expense-patterns-heading" className="font-serif text-lg text-warm-700">Expense patterns</h2>
            <p className="mt-1 text-xs text-warm-400">These reports always analyze spending, independent of the filter above.</p>
          </div>
          <span className="rounded-full bg-expense-light px-2.5 py-1 text-xs font-semibold text-expense">Expenses only</span>
        </motion.div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <motion.div variants={fadeUp} className="card p-5">
            <CardHeader icon={Layers} title="Category Trends" subtitle="Top spending categories over time" />
            <CategoryTrendsChart data={data.categoryTrends} currency={currency} hideAmounts={hideAmounts} />
          </motion.div>
          <motion.div variants={fadeUp} className="card p-5">
            <CardHeader icon={CalendarDays} title="Spending Heatmap" subtitle="Which days do you spend most?" />
            <SpendingHeatmap data={data.daily} currency={currency} hideAmounts={hideAmounts} returnTo={returnTo} />
          </motion.div>
        </div>
      </section>

      <motion.div variants={fadeUp} className="card p-5">
        <CardHeader icon={ArrowLeftRight} title="Incomes & Expenses Report" subtitle="All transaction types, current vs previous period by category" />
        <IncomeExpensesReport
          periodLabel={data.periodLabel}
          previousPeriodLabel={data.previousPeriodLabel}
          summary={data.summary}
          previousSummary={data.previousSummary}
          categoryBreakdown={data.allCategoryBreakdown}
          previousCategoryBreakdown={data.allPreviousCategoryBreakdown}
          currency={currency}
          hideAmounts={hideAmounts}
          comparisonAvailable={data.periodContext.comparisonStatus === "available"}
        />
      </motion.div>
    </motion.div>
  );
}
