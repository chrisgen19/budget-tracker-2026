"use client";

import { DATE_PRESETS } from "@/lib/analytics-period";

interface DatePresetsProps {
  tz: number;
  onSelect: (from: string, to: string) => void;
}

/** Quick range buttons shown inside the time range picker dropdown. */
export function DatePresets({ tz, onSelect }: DatePresetsProps) {
  return (
    <div className="flex gap-1.5 px-3 pt-3">
      {DATE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => {
            const { from, to } = preset.getRange(tz);
            onSelect(from, to);
          }}
          className="flex-1 py-2 px-2 rounded-lg text-xs font-medium text-warm-500 bg-cream-100 hover:bg-cream-200 transition-colors"
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
