"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, TOUCH_HIT_AREA_CENTERED } from "@/lib/utils";
import { formatMonthKey, shiftMonthKey } from "@/lib/month-key";

const ARROW = cn(
  "relative p-1.5 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors",
  TOUCH_HIT_AREA_CENTERED
);

/** The dashboard's month arrows, over a `YYYY-MM` key rather than a Date. */
export function MonthSwitcher({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-cream-300/60 bg-white px-2 py-1.5 shadow-warm sm:justify-start">
      <button type="button" onClick={() => onChange(shiftMonthKey(month, -1))} aria-label="Previous month" className={ARROW}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span aria-live="polite" className="min-w-28 text-center text-sm font-medium text-warm-600 sm:min-w-[120px]">
        {formatMonthKey(month)}
      </span>
      <button type="button" onClick={() => onChange(shiftMonthKey(month, 1))} aria-label="Next month" className={ARROW}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
