"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, GitCompareArrows, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { AMBER_COLOR } from "@/components/analytics/chart-theme";
import { BalanceTrendPlot, PREVIOUS_MONTH_COLOR } from "@/components/dashboard/balance-trend-plot";
import { accountDateKey } from "@/lib/account-time";
import {
  buildBalanceChartRows,
  formatSignedAmount,
  monthShortName,
  summarizeBalance,
  type BalanceSummary,
} from "@/lib/balance-trend";
import { cn, formatCurrency, maskCurrency } from "@/lib/utils";
import type { BalanceMonth } from "@/types";

export const COMPARE_STORAGE_KEY = "balance-trend-compare";

/**
 * The compare toggle, remembered on this device. Storage throws in embedded webviews, private
 * modes and when site data is blocked; the toggle is a convenience, so that degrades to "off".
 * Read lazily rather than in an effect so a remembered "on" does not paint once as "off" and then
 * replay the chart's animation. The card only mounts once the dashboard query has resolved on the
 * client, so there is no server render for this to disagree with.
 */
function useStoredCompare(): [boolean, () => void] {
  const [compare, setCompare] = useState(() => {
    try {
      return localStorage.getItem(COMPARE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !compare;
    setCompare(next);
    try {
      localStorage.setItem(COMPARE_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Not persisted; the toggle still works for this visit.
    }
  };
  return [compare, toggle];
}

interface BalanceTrendChartProps {
  months: { current: BalanceMonth; previous: BalanceMonth };
  hideAmounts: boolean;
  timezoneOffset: number;
  currency?: string;
}

export function BalanceTrendChart({ months, hideAmounts, timezoneOffset, currency = "PHP" }: BalanceTrendChartProps) {
  const [compare, toggleCompare] = useStoredCompare();
  const { current, previous } = months;
  const todayKey = accountDateKey(new Date(), timezoneOffset);
  const summary = summarizeBalance(current, previous, todayKey);
  const currentName = monthShortName(current.month);
  const previousName = monthShortName(previous.month);
  const rows = buildBalanceChartRows({ current, previous, todayKey, compare });

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg text-warm-700">Balance Trend</h2>
          <p className="text-xs text-warm-300">Do I have more money than before?</p>
        </div>
        {summary.status !== "future" && (
          <CompareToggle pressed={compare} onToggle={toggleCompare} previousName={previousName} />
        )}
      </div>

      <BalanceMetrics summary={summary} currentName={currentName} hideAmounts={hideAmounts} currency={currency} />

      {compare && summary.status !== "future" && (
        <ComparisonKey
          summary={summary}
          currentName={currentName}
          previousName={previousName}
          hideAmounts={hideAmounts}
          currency={currency}
        />
      )}

      {summary.status === "future" ? (
        <div className="h-[180px] flex items-center justify-center">
          <p className="text-warm-300 text-sm">{currentName} hasn&apos;t started yet</p>
        </div>
      ) : (
        <BalanceTrendPlot
          rows={rows}
          compare={compare}
          currentName={currentName}
          previousName={previousName}
          todayDay={summary.status === "current" ? summary.elapsedDays : null}
          daysInMonth={current.days.length}
          hideAmounts={hideAmounts}
          currency={currency}
        />
      )}

      {summary.status === "current" && (
        <div className="flex justify-end mt-2">
          <Link
            href="/analytics?tab=forecast"
            className="relative inline-flex items-center gap-1 text-xs font-medium text-amber hover:text-amber-dark transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
          >
            See forecast
            <ArrowRight className="w-3 h-3" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}

/** "vs Aug": a small pill with a 44px hit area, as the AGENTS.md touch-target rule asks. */
function CompareToggle({ pressed, onToggle, previousName }: { pressed: boolean; onToggle: () => void; previousName: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "relative shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
        pressed
          ? "border-amber/30 bg-amber-light text-amber-dark"
          : "border-cream-300 bg-cream-50 text-warm-500 hover:bg-cream-100"
      )}
    >
      <GitCompareArrows className="w-3.5 h-3.5" aria-hidden />
      <span className="sr-only">Compare</span> vs {previousName}
    </button>
  );
}

interface MetricsProps {
  summary: BalanceSummary;
  currentName: string;
  hideAmounts: boolean;
  currency: string;
}

/** Where the balance stands, and how far it has moved since the 1st. */
function BalanceMetrics({ summary, currentName, hideAmounts, currency }: MetricsProps) {
  const balanceLabel =
    summary.status === "current" ? "Balance today" : summary.status === "past" ? `End of ${currentName}` : "Opening balance";
  const changeLabel = summary.status === "past" ? `In ${currentName}` : "This month";
  const Icon = summary.change > 0 ? TrendingUp : summary.change < 0 ? TrendingDown : Minus;

  return (
    <div className="flex items-start justify-between gap-3 mt-4 mb-4">
      <div className="min-w-0">
        <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">{balanceLabel}</p>
        <span className="font-serif text-xl text-warm-700 tabular-nums">
          {maskCurrency(summary.balance, currency, hideAmounts)}
        </span>
      </div>
      {summary.elapsedDays > 0 && (
        <div className="text-right shrink-0">
          <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">{changeLabel}</p>
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-sm font-medium tabular-nums",
              summary.change > 0 && "bg-income-light text-income",
              summary.change < 0 && "bg-expense-light text-expense",
              summary.change === 0 && "bg-cream-200 text-warm-400"
            )}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden />
            {formatSignedAmount(summary.change, currency, hideAmounts)}
          </span>
        </div>
      )}
    </div>
  );
}

interface ComparisonKeyProps extends MetricsProps {
  previousName: string;
}

/** The legend for the overlay, and the one sentence it exists to answer. */
function ComparisonKey({ summary, currentName, previousName, hideAmounts, currency }: ComparisonKeyProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs">
      <span className="inline-flex items-center gap-1.5 text-warm-500">
        <span className="w-4 h-0.5 rounded-full" style={{ backgroundColor: AMBER_COLOR }} aria-hidden />
        {currentName}
      </span>
      <span className="inline-flex items-center gap-1.5 text-warm-500">
        <span className="w-4 border-t-2 border-dashed" style={{ borderColor: PREVIOUS_MONTH_COLOR }} aria-hidden />
        {previousName}
      </span>
      <span className="text-warm-400">
        {describeComparison(summary, currentName, previousName, hideAmounts, currency)}
      </span>
    </div>
  );
}

/** "₱9,500.00 ahead of Aug at this point", or "Sep ended ₱9,500.00 ahead of Aug" for a past month. */
const describeComparison = (
  summary: BalanceSummary,
  currentName: string,
  previousName: string,
  hideAmounts: boolean,
  currency: string,
): string => {
  if (summary.previousChange == null) return `Nothing logged in ${previousName} to compare`;

  const gap = Math.round((summary.change - summary.previousChange) * 100) / 100;
  const standing =
    gap === 0
      ? `level with ${previousName}`
      : `${hideAmounts ? "" : `${formatCurrency(Math.abs(gap), currency)} `}${gap > 0 ? "ahead of" : "behind"} ${previousName}`;

  if (summary.status === "past") return `${currentName} ended ${standing}`;
  const sentence = `${standing} at this point`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};
