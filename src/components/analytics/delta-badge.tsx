"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeltaBadgeProps {
  current: number;
  previous: number;
  /** Flip good/bad semantics — an increase in expenses is bad */
  invert?: boolean;
  /** No good/bad coloring (e.g. transaction counts) */
  neutral?: boolean;
}

/** Period-over-period % change pill. Percentages are relative, so they stay visible under hideAmounts. */
export function DeltaBadge({ current, previous, invert = false, neutral = false }: DeltaBadgeProps) {
  const base = "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium tabular-nums";

  if (previous === 0) {
    if (current === 0) {
      return <span className={cn(base, "bg-cream-200 text-warm-400")}>—</span>;
    }
    return <span className={cn(base, "bg-amber-light text-amber-dark")}>New</span>;
  }

  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  const isUp = pct > 0;
  const isFlat = pct === 0;
  const isGood = invert ? pct < 0 : pct > 0;

  const tone = neutral || isFlat
    ? "bg-cream-200 text-warm-400"
    : isGood
      ? "bg-income-light text-income"
      : "bg-expense-light text-expense";

  const Icon = isFlat ? Minus : isUp ? TrendingUp : TrendingDown;

  return (
    <span className={cn(base, tone)}>
      <Icon className="w-3 h-3" />
      {isUp ? "+" : ""}{pct}%
    </span>
  );
}
