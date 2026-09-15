"use client";

import { CircleAlert, Clock3 } from "lucide-react";
import type { AnalyticsPeriodContext } from "@/types";

interface PeriodComparisonNoteProps {
  context: AnalyticsPeriodContext;
  previousPeriodLabel: string;
}

export function PeriodComparisonNote({
  context,
  previousPeriodLabel,
}: PeriodComparisonNoteProps) {
  if (!context.isPartial && context.comparisonStatus === "available") return null;

  const lowCoverage = context.comparisonStatus === "low-coverage";
  const Icon = lowCoverage ? CircleAlert : Clock3;
  const tone = lowCoverage
    ? "border-amber-200 bg-amber-50/70 text-amber-800"
    : "border-cream-300 bg-cream-50/70 text-warm-500";

  let detail = context.isPartial
    ? `Showing ${context.daysElapsed} of ${context.daysInPeriod} calendar days so far.`
    : `Totals cover all ${context.daysInPeriod} calendar days.`;
  if (context.comparisonStatus === "available") {
    detail += ` Changes use the matching window in ${previousPeriodLabel}.`;
  } else if (lowCoverage) {
    detail += ` Changes are hidden because logged-day coverage is below ${context.coverageThresholdPct}% (${context.currentCoveragePct}% current, ${context.previousCoveragePct}% previous).`;
  } else if (context.comparisonStatus === "no-previous-data") {
    detail += ` Changes are hidden because ${previousPeriodLabel} has no transactions.`;
  } else if (context.comparisonStatus === "too-early") {
    detail += " Changes appear once today has transactions.";
  } else {
    detail = "This period has not started, so there are no actuals or comparisons yet.";
  }

  return (
    <div className={`mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 ${tone}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="text-xs leading-relaxed">{detail}</p>
    </div>
  );
}
