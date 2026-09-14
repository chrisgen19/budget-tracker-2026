"use client";

import { useMemo, useState } from "react";
import { cn, formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { ChartEmptyState } from "@/components/analytics/chart-empty-state";
import { HeatmapFooter } from "@/components/analytics/heatmap-footer";
import {
  INTENSITY_CLASSES,
  formatDayLabel,
  groupIntoWeeks,
  heatmapMode,
  intensityScale,
  monthOf,
  weekdayAverages,
} from "@/components/analytics/heatmap-utils";
import { MONTH_NAMES } from "@/lib/analytics-buckets";
import type { AnalyticsDailyItem } from "@/types";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface SpendingHeatmapProps {
  data: AnalyticsDailyItem[];
  currency: string;
  hideAmounts: boolean;
  /** The analytics view to offer as a way back, as a query string for /analytics. */
  returnTo: string;
}

export function SpendingHeatmap({ data, currency, hideAmounts, returnTo }: SpendingHeatmapProps) {
  // Store only the date string; derive the item from current data so a stale
  // selection can't outlive a period change (it resolves to null instead)
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selected = selectedDate ? data.find((d) => d.date === selectedDate) ?? null : null;
  const mode = heatmapMode(data.length);
  const intensity = useMemo(() => intensityScale(data.map((d) => d.expenses)), [data]);
  const weeks = useMemo(() => (mode === "weekday" ? [] : groupIntoWeeks(data)), [data, mode]);
  const byWeekday = useMemo(() => (mode === "weekday" ? weekdayAverages(data) : []), [data, mode]);
  const weekdayIntensity = useMemo(() => intensityScale(byWeekday.map((s) => s.avg)), [byWeekday]);

  if (data.length === 0 || data.every((d) => d.expenses === 0)) {
    return <ChartEmptyState message="No spending in this period" hint="Add expense transactions to see your spending pattern" />;
  }

  const sym = getCurrencySymbol(currency);
  const fmt = (v: number) => (hideAmounts ? `${sym} ••••••` : formatCurrency(v, currency));
  const multiYear = data.length > 0 && data[0].date.slice(0, 4) !== data[data.length - 1].date.slice(0, 4);

  const dayCell = (day: AnalyticsDailyItem | null, idx: number, compact: boolean) => {
    if (!day) return <span key={`pad-${idx}`} className={compact ? "flex-1 aspect-square" : "aspect-square"} />;
    const isSelected = selected?.date === day.date;
    return (
      <button
        key={day.date}
        onClick={() => setSelectedDate(isSelected ? null : day.date)}
        aria-label={formatDayLabel(day.date, multiYear)}
        // It is a toggle, and said so only in colour until now.
        aria-pressed={isSelected}
        className={cn(
          "aspect-square transition-shadow",
          compact ? "flex-1 rounded-[3px]" : "rounded-md text-[10px] text-warm-500",
          INTENSITY_CLASSES[intensity(day.expenses)],
          intensity(day.expenses) >= 4 && !compact && "text-white",
          isSelected && "ring-2 ring-amber ring-offset-1 ring-offset-white"
        )}
      >
        {!compact && Number(day.date.split("-")[2])}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {mode === "calendar" && (
        <div className="space-y-1">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((d) => (
              <span key={d} className="text-[10px] text-warm-300 text-center">{d}</span>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((day, di) => dayCell(day, wi * 7 + di, false))}
            </div>
          ))}
        </div>
      )}

      {mode === "weeks" && (
        <div className="space-y-1">
          {/* Month ticks: label columns where the month changes */}
          <div className="flex gap-[2px]">
            {weeks.map((week, wi) => {
              const first = week.find(Boolean);
              const prevFirst = wi > 0 ? weeks[wi - 1].find(Boolean) : null;
              const showLabel = first && (!prevFirst || monthOf(first.date) !== monthOf(prevFirst.date));
              return (
                <span key={wi} className="flex-1 text-[8px] text-warm-300 overflow-visible whitespace-nowrap">
                  {showLabel ? MONTH_NAMES[monthOf(first.date)] : ""}
                </span>
              );
            })}
          </div>
          {Array.from({ length: 7 }).map((_, dow) => (
            <div key={dow} className="flex gap-[2px]">
              {weeks.map((week, wi) => dayCell(week[dow], wi, true))}
            </div>
          ))}
        </div>
      )}

      {mode === "weekday" && (
        <div className="grid grid-cols-7 gap-1.5">
          {byWeekday.map((slot, i) => (
            <div key={WEEKDAY_LABELS[i]} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-warm-300">{WEEKDAY_LABELS[i]}</span>
              <div
                title={`Avg ${fmt(slot.avg)} across ${slot.count} ${WEEKDAY_LABELS[i]}s`}
                className={cn(
                  "w-full aspect-square rounded-md",
                  INTENSITY_CLASSES[weekdayIntensity(slot.avg)]
                )}
              />
              <span className="text-[10px] text-warm-400 tabular-nums">
                {hideAmounts ? "••" : formatCurrency(slot.avg, currency).replace(/\.\d+$/, "")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Legend, the selected day, and the way into that day's transactions. */}
      <HeatmapFooter
        mode={mode}
        selected={selected}
        multiYear={multiYear}
        fmt={fmt}
        returnTo={returnTo}
      />
    </div>
  );
}
