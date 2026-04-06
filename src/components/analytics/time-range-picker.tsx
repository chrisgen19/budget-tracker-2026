"use client";

import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyticsGranularity } from "@/types";

interface TimeRangePickerProps {
  granularity: AnalyticsGranularity;
  from: string;
  to: string;
  isCustom: boolean;
  onGranularityChange: (g: AnalyticsGranularity) => void;
  onCustomToggle: () => void;
  onRangeChange: (from: string, to: string) => void;
  onNavigate: (direction: "prev" | "next") => void;
}

const GRANULARITY_OPTIONS: { value: AnalyticsGranularity; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export function TimeRangePicker({
  granularity,
  from,
  to,
  isCustom,
  onGranularityChange,
  onCustomToggle,
  onRangeChange,
  onNavigate,
}: TimeRangePickerProps) {
  return (
    <div className="space-y-3">
      {/* Granularity toggle row */}
      <div className="flex items-center gap-2">
        <div className="flex bg-cream-100 rounded-xl p-1 gap-0.5">
          {GRANULARITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onGranularityChange(opt.value)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                granularity === opt.value && !isCustom
                  ? "bg-white text-warm-700 shadow-sm"
                  : "text-warm-400 hover:text-warm-600"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          onClick={onCustomToggle}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            isCustom
              ? "bg-amber-50 text-amber-700 border border-amber-200"
              : "text-warm-400 hover:text-warm-600 border border-cream-200"
          )}
        >
          <Calendar className="w-3.5 h-3.5" />
          Custom
        </button>
      </div>

      {/* Navigation + date range display */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onNavigate("prev")}
          className="p-1.5 rounded-lg hover:bg-cream-100 text-warm-400 hover:text-warm-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {isCustom ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              type="date"
              value={from}
              onChange={(e) => onRangeChange(e.target.value, to)}
              className="flex-1 px-3 py-1.5 rounded-lg border border-cream-200 bg-white text-sm text-warm-600 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
            <span className="text-xs text-warm-400">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => onRangeChange(from, e.target.value)}
              className="flex-1 px-3 py-1.5 rounded-lg border border-cream-200 bg-white text-sm text-warm-600 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
          </div>
        ) : (
          <span className="flex-1 text-sm text-warm-600 text-center font-medium">
            {formatRangeLabel(from, to)}
          </span>
        )}

        <button
          onClick={() => onNavigate("next")}
          className="p-1.5 rounded-lg hover:bg-cream-100 text-warm-400 hover:text-warm-600 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** Format a date range into a readable label. */
const formatRangeLabel = (from: string, to: string): string => {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [fY, fM, fD] = from.split("-").map(Number);
  const [tY, tM, tD] = to.split("-").map(Number);

  // Same year — show "Jan – Jun 2026"
  if (fY === tY) {
    if (fM === tM && fD === 1) {
      return `${MONTHS[fM - 1]} ${fY}`;
    }
    return `${MONTHS[fM - 1]} ${fD} – ${MONTHS[tM - 1]} ${tD}, ${tY}`;
  }

  return `${MONTHS[fM - 1]} ${fD}, ${fY} – ${MONTHS[tM - 1]} ${tD}, ${tY}`;
};
