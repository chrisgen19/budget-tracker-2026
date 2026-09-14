"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DrillDownLink, drillDownLabel } from "@/components/analytics/drill-down-link";
import { buildTransactionsHref } from "@/lib/transaction-filter-url";
import { INTENSITY_CLASSES, formatDayLabel, type HeatmapMode } from "@/components/analytics/heatmap-utils";
import type { AnalyticsDailyItem } from "@/types";

function Legend() {
  return (
    <div className="flex shrink-0 items-center gap-1 text-[10px] text-warm-300">
      less
      {INTENSITY_CLASSES.map((c) => (
        <span key={c} className={cn("w-2.5 h-2.5 rounded-[3px]", c)} />
      ))}
      more
    </div>
  );
}

interface HeatmapFooterProps {
  mode: HeatmapMode;
  /** The day the user tapped, or null when nothing is selected. */
  selected: AnalyticsDailyItem | null;
  /** True when the period spans more than one year, so labels carry the year. */
  multiYear: boolean;
  /** Formats an amount, already honouring hide-amounts. */
  fmt: (value: number) => string;
  /** The analytics view to offer as a way back, as a query string for /analytics. */
  returnTo: string;
}

/**
 * The heatmap's footer: the legend, the selected day, and the way into that day's
 * transactions.
 *
 * The drill-down is deliberately a second tap rather than the cell itself. Two
 * reasons, and they pull the same way. A day cell is roughly 40px in calendar mode
 * and between 3 and 20px in weeks mode, all under the 44px minimum, so the cell
 * cannot be the control that navigates. And on touch there is no hover, which makes
 * tapping a cell the only way to read what a day cost -- the same argument
 * `category-breakdown-chart.tsx` makes for why the donut slices are not links. A
 * cell that navigated would spend the chart's only inspect gesture on leaving it.
 *
 * So the cell selects and this row navigates, at a full 44px with the affordance to
 * match. `aria-live` because the row appears in response to a tap somewhere else,
 * and its arrival is otherwise silent to a screen reader.
 */
export function HeatmapFooter({ mode, selected, multiYear, fmt, returnTo }: HeatmapFooterProps) {
  // A weekday cell is an average across many dates, so there is no single day to
  // open, and `filterSearchParams` has no way to say "every Tuesday" regardless.
  const dayLabel = selected ? formatDayLabel(selected.date, multiYear) : null;
  const drillable = mode !== "weekday" && selected !== null && selected.count > 0;

  const caption = () => {
    if (mode === "weekday") {
      return <p className="min-w-0 truncate text-[10px] text-warm-300">Average daily spend per weekday</p>;
    }
    if (!selected) {
      return <p className="min-w-0 truncate text-[10px] text-warm-300">Tap a day for details</p>;
    }
    return (
      <p className="min-w-0 truncate text-xs text-warm-500">
        <span className="font-medium text-warm-600">{dayLabel}</span>
        {selected.count > 0
          ? ` · ${fmt(selected.expenses)} spent · ${selected.count} ${selected.count === 1 ? "txn" : "txns"}`
          : " · nothing logged"}
      </p>
    );
  };

  return (
    <div className="space-y-2 pt-1" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        {caption()}
        <Legend />
      </div>

      {drillable && (
        // No hover class of its own: `DrillDownLink` already carries the shared
        // hover tint and focus ring, and `cn` is a plain join, so a competing
        // `hover:bg-*` here would come down to stylesheet order.
        <DrillDownLink
          href={buildTransactionsHref({ from: selected.date, to: selected.date, ret: returnTo })}
          label={drillDownLabel(selected.count, dayLabel!)}
          className="flex min-h-11 items-center justify-between gap-2 border border-amber/25 bg-amber-50 px-3 text-sm font-medium text-amber"
        >
          <span>
            View {selected.count} {selected.count === 1 ? "transaction" : "transactions"}
          </span>
          <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </DrillDownLink>
      )}
    </div>
  );
}
