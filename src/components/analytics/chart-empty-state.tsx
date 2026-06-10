"use client";

import type { LucideIcon } from "lucide-react";
import { CalendarOff } from "lucide-react";

interface ChartEmptyStateProps {
  icon?: LucideIcon;
  message: string;
  hint?: string;
}

/** Compact empty state sized for chart slots. */
export function ChartEmptyState({ icon: Icon = CalendarOff, message, hint }: ChartEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 h-[200px] text-center">
      <div className="w-12 h-12 rounded-2xl bg-cream-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-warm-300" />
      </div>
      <p className="text-sm text-warm-500">{message}</p>
      {hint && <p className="text-xs text-warm-300 max-w-[240px]">{hint}</p>}
    </div>
  );
}
