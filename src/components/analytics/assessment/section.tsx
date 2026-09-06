"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeUp } from "@/components/analytics/motion-variants";
import type { AiWatchSeverity } from "@/types";

/** How an amount is rendered here: already masked when Hide Amounts is on. */
export type Money = (value: number | null) => string;

export const SEVERITY_STYLES: Record<AiWatchSeverity, { dot: string; text: string; chip: string; label: string }> = {
  high: { dot: "bg-expense", text: "text-expense", chip: "bg-expense-light text-expense-dark", label: "High" },
  medium: { dot: "bg-amber", text: "text-amber-dark", chip: "bg-amber-light text-amber-dark", label: "Medium" },
  low: { dot: "bg-warm-300", text: "text-warm-400", chip: "bg-cream-100 text-warm-400", label: "Low" },
};

interface SectionProps {
  icon: LucideIcon;
  title: string;
  /** Short line under the title saying what the section is measured against. */
  subtitle?: string;
  /** Rendered at the top right — a count, a status, a period. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

export function Section({ icon: Icon, title, subtitle, aside, children }: SectionProps) {
  return (
    <motion.div variants={fadeUp} className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-amber shrink-0" />
            <h3 className="font-serif text-lg text-warm-700">{title}</h3>
          </div>
          {subtitle && <p className="text-xs text-warm-400 mt-1">{subtitle}</p>}
        </div>
        {aside && <div className="shrink-0 text-right">{aside}</div>}
      </div>
      {children}
    </motion.div>
  );
}

/** A small labelled chip — the count, the verdict, the status. */
export function Chip({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-cream-100 text-warm-500",
    good: "bg-income-light text-income-dark",
    warn: "bg-amber-light text-amber-dark",
    bad: "bg-expense-light text-expense-dark",
  } as const;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase", tones[tone])}>
      {children}
    </span>
  );
}

/**
 * A proportional bar.
 *
 * Widths are clamped to a floor of 2%: a real value that renders as nothing at
 * all reads as missing data, which is the opposite of what a bar is for.
 */
export function Bar({ value, max, tone }: { value: number; max: number; tone: "up" | "down" | "neutral" }) {
  const width = max <= 0 ? 0 : Math.max(2, Math.min(100, Math.round((Math.abs(value) / max) * 100)));
  const fill = tone === "up" ? "bg-expense/70" : tone === "down" ? "bg-income/70" : "bg-warm-300";
  return (
    <div className="h-1.5 rounded-full bg-cream-200/70 overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", fill)} style={{ width: `${width}%` }} />
    </div>
  );
}

/** Empty state for a section that ran and found nothing — which is itself a result. */
export function AllClear({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-warm-400">{children}</p>;
}
