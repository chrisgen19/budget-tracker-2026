"use client";

import { cn } from "@/lib/utils";
import type { AnalyticsTypeFilter } from "@/types";

interface TypeFilterProps {
  value: AnalyticsTypeFilter;
  onChange: (type: AnalyticsTypeFilter) => void;
}

// Expenses first, and the card opens on it: "where is my money going?" is the
// question these breakdowns exist to answer, and ALL mixes income categories
// into the same ring. All stays last as the escape hatch, not the default.
const OPTIONS: { value: AnalyticsTypeFilter; label: string }[] = [
  { value: "EXPENSE", label: "Expenses" },
  { value: "INCOME", label: "Income" },
  { value: "ALL", label: "All" },
];

export function TypeFilter({ value, onChange }: TypeFilterProps) {
  return (
    <div className="flex bg-cream-100 rounded-xl p-1 gap-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
            value === opt.value
              ? "bg-white text-warm-700 shadow-sm"
              : "text-warm-400 hover:text-warm-600"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
