"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared card chrome for Recharts custom tooltips. */
export function ChartTooltipCard({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-soft-md border border-cream-200 px-3.5 py-2.5">
      {label && <p className="text-xs text-warm-400 mb-1.5">{label}</p>}
      {children}
    </div>
  );
}

interface TooltipRowProps {
  label: string;
  value: string;
  color?: string;
  className?: string;
}

/** One label/value line inside a ChartTooltipCard. */
export function TooltipRow({ label, value, color, className }: TooltipRowProps) {
  return (
    <p className={cn("text-sm font-medium text-warm-600 flex items-center gap-1.5", className)}>
      {color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      <span className="text-warm-400 font-normal">{label}</span>
      <span className="tabular-nums ml-auto pl-3">{value}</span>
    </p>
  );
}
