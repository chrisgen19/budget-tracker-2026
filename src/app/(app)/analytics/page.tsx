"use client";

import { useState, useCallback, useMemo, useRef, useEffect, type RefObject } from "react";
import { motion, useIsomorphicLayoutEffect } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  Heart,
  Layers,
  PieChart,
  Sparkles,
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
import { AnalyticsHeroSkeleton, AnalyticsContentSkeleton } from "@/components/analytics/analytics-skeleton";
import { RecordsStatistics } from "@/components/analytics/records-statistics";
import { FinancialHealthScore } from "@/components/analytics/financial-health-score";
import { AiAssessmentReport } from "@/components/analytics/ai-assessment-report";
import { stagger, fadeUp } from "@/components/analytics/motion-variants";
import type { AnalyticsTypeFilter } from "@/types";

type AnalyticsTab = "reports" | "statistics" | "health" | "ai-assessment";

const ANALYTICS_TABS = [
  { id: "reports" as const, label: "Reports", shortLabel: "Reports", icon: BarChart3 },
  { id: "statistics" as const, label: "Records & Statistics", shortLabel: "Stats", icon: Trophy },
  { id: "health" as const, label: "Financial Health", shortLabel: "Health", icon: Heart },
  { id: "ai-assessment" as const, label: "AI Assessment", shortLabel: "AI", icon: Sparkles },
];

/**
 * Tracks whether `ref` is visible below a `topOffset` (px) from the viewport top —
 * used to know when the in-page controls have scrolled under the fixed header.
 *
 * Measures synchronously before paint so the initial value is correct whether the
 * page mounts at the top (no sticky-bar flash) or already scrolled (restored scroll
 * / bfcache — bar shown immediately, no lag). Re-measures on scroll, on resize, and
 * when the page height changes (ResizeObserver) — always on the next animation frame
 * so the browser has settled layout/scroll first. This matters when switching to a
 * shorter tab: the page shrinks and the scroll position clamps without firing a
 * scroll event, which an IntersectionObserver alone can miss (leaving the bar stuck).
 */
function useVisibleBelowOffset<T extends Element>(
  ref: RefObject<T | null>,
  topOffset: number,
  /** Changes to this re-measure on the next frame (e.g. a tab switch that changes
   *  page height and clamps the scroll without firing a scroll event). */
  recomputeToken?: unknown,
) {
  const [inView, setInView] = useState(true);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setInView(rect.bottom > topOffset && rect.top < window.innerHeight);
    };
    // Defer to the next frame so scroll-clamping from a height change has applied.
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(document.documentElement);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [ref, topOffset]);

  // Re-measure when content that affects page height changes. The scroll can clamp
  // without a scroll event, so do it on the next frame once layout has settled.
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      setInView(rect.bottom > topOffset && rect.top < window.innerHeight);
    });
    return () => cancelAnimationFrame(raf);
  }, [ref, topOffset, recomputeToken]);

  return inView;
}

/**
 * Tab switcher. `layoutId` must be unique per rendered instance — the in-page and
 * sticky copies are mounted at once, and a shared id would make the active pill
 * animate across the two bars.
 */
function AnalyticsTabBar({
  activeTab,
  onSelect,
  layoutId,
  className,
}: {
  activeTab: AnalyticsTab;
  onSelect: (tab: AnalyticsTab) => void;
  layoutId: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "grid grid-cols-4 w-full gap-1 p-1 bg-cream-100 rounded-xl sm:flex sm:w-fit",
        className
      )}
    >
      {ANALYTICS_TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            "relative flex items-center justify-center gap-1 sm:gap-1.5 min-w-0 px-2 sm:px-3 py-2.5 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors",
            activeTab === tab.id ? "text-warm-700" : "text-warm-400 hover:text-warm-500"
          )}
        >
          {activeTab === tab.id && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 bg-white rounded-lg shadow-sm"
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            />
          )}
          <tab.icon className="relative w-4 h-4 shrink-0" />
          <span className="relative truncate">
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.shortLabel}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

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

  // Sticky controls bar: a combined period-nav + tabs bar whose two rows are revealed
  // independently — each row appears as soon as its in-page counterpart scrolls out of
  // view, so the period picker is reachable the moment the header nav leaves (not only
  // once the tabs leave) while never duplicating a control that's still on screen.
  // Below `lg` the app shell has a fixed 4rem header, so offset the observers by it
  // (the controls are unusable once they slide under that header); no offset on desktop.
  const periodNavRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  // Seed the offset from the current viewport so the first (synchronous) measure
  // already uses the right value on mobile, before the resize listener runs.
  const [topOffset, setTopOffset] = useState(() =>
    typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches ? 64 : 0,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setTopOffset(mq.matches ? 0 : 64);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  // Re-measure when the active tab or load state changes — switching to a shorter
  // tab collapses the page and clamps the scroll, bringing the in-page controls back.
  const recomputeToken = `${activeTab}:${isLoading}`;
  const periodNavInView = useVisibleBelowOffset(periodNavRef, topOffset, recomputeToken);

  // Distance from the sticky bar's top to the bottom of the pinned period row
  // (its offsetTop within the fixed bar + its height, so the bar's own padding is
  // included). The tab sentinel uses this so the in-page tab bar counts as "out of
  // view" the moment it slides under that fixed row — otherwise there's a band where
  // the period row covers the in-page tabs but the sticky tabs row hasn't appeared.
  const periodRowRef = useRef<HTMLDivElement>(null);
  const [periodRowExtent, setPeriodRowExtent] = useState(0);
  useIsomorphicLayoutEffect(() => {
    const el = periodRowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Keep the last non-zero value: the row is display:none (extent 0) while hidden,
    // so caching avoids a 1-frame wrong offset when it re-appears.
    const measure = () => {
      const extent = el.offsetTop + el.offsetHeight;
      if (el.offsetHeight > 0) setPeriodRowExtent(extent);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // When the period row is pinned, the tab bar must clear below it; otherwise just the header.
  const tabTopOffset = topOffset + (periodNavInView ? 0 : periodRowExtent);
  const tabBarInView = useVisibleBelowOffset(tabBarRef, tabTopOffset, recomputeToken);

  // Each in-page control is inert exactly when its sticky row is shown; derived
  // directly from visibility so it can never get stuck. The bar itself is active
  // whenever either row is shown.
  const stickyActive = !periodNavInView || !tabBarInView;

  return (
    <div>
      {/* Page Header + Period Selector */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">Analytics</h1>
          <p className="text-warm-400 text-sm mt-1">Reports &amp; insights</p>
        </div>
        {/* Inert once its sticky row is shown, so keyboard / screen-reader users
            never hit two interactive period pickers. */}
        <div ref={periodNavRef} inert={!periodNavInView}>
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
      </div>

      {/* Sticky controls bar — combined period nav + tabs. Each row is shown only when
          its in-page counterpart has scrolled out of view, so a control is pinned the
          moment it leaves (and never duplicated while still on screen). Always mounted
          and toggled with CSS + inert (no mount/unmount race) so it can't leave a hidden
          click-catching ghost. */}
      <div
        inert={!stickyActive}
        aria-hidden={!stickyActive}
        className={cn(
          "fixed top-16 lg:top-0 left-0 right-0 lg:left-64 z-30 bg-cream-100/90 backdrop-blur-md border-b border-cream-300/60 transition-[opacity,transform] duration-200",
          stickyActive ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
        )}
      >
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-2.5 space-y-2">
          {/* Each row is always mounted and shown via `hidden` (no mount churn) so a
              momentarily-stale measure can't cause a flicker; the matching in-page
              control is hidden whenever its sticky row is visible. */}
          <div ref={periodRowRef} className={cn(periodNavInView && "hidden")}>
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
          <div className={cn("justify-center", tabBarInView ? "hidden" : "flex")}>
            <AnalyticsTabBar
              activeTab={activeTab}
              onSelect={setActiveTab}
              layoutId="analytics-tab-sticky"
              className="sm:w-fit"
            />
          </div>
        </div>
      </div>

      {/* Hero overview — above the tabs: it's tab-independent and changes only
          with the selected period, so it stays put while the tabs switch below. */}
      {isLoading ? (
        <div className="mb-6">
          <AnalyticsHeroSkeleton />
        </div>
      ) : isError || !data ? null : (
        <motion.div variants={stagger} initial="hidden" animate="show" className="mb-6">
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
      )}

      {/* Tab Bar — sticky-bar sentinel; inert once its sticky row is shown */}
      <div ref={tabBarRef} inert={!tabBarInView} className="mb-6">
        <AnalyticsTabBar
          activeTab={activeTab}
          onSelect={setActiveTab}
          layoutId="analytics-tab"
          className="sm:w-fit"
        />
      </div>

      {isLoading ? (
        <AnalyticsContentSkeleton />
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
          {/* Reports Tab */}
          {activeTab === "reports" && (
            <motion.div
              key="reports"
              variants={stagger}
              initial="hidden"
              animate="show"
              className="space-y-4"
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
            <motion.div key="statistics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <RecordsStatistics statistics={data.statistics} currency={currency} hideAmounts={hideAmounts} />
            </motion.div>
          )}

          {/* Financial Health Tab */}
          {activeTab === "health" && (
            <motion.div key="health" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <FinancialHealthScore healthScore={data.healthScore} />
            </motion.div>
          )}

          {/* AI Assessment Tab */}
          {activeTab === "ai-assessment" && (
            <motion.div key="ai-assessment" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <AiAssessmentReport
                data={data}
                period={{ granularity: params.granularity, from: params.from, to: params.to }}
                currency={currency}
                hideAmounts={hideAmounts}
              />
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
