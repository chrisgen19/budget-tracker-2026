"use client";

import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Section, Chip, AllClear } from "./section";
import type { AssessmentDataConfidence } from "@/types";

const STATUS_TONE = {
  ok: "bg-income/60",
  "low-coverage": "bg-expense/60",
  partial: "bg-amber/60",
} as const;

/**
 * How much of the window was actually logged.
 *
 * First on the page on purpose. Every figure below it is only as good as this
 * one, and a month logged on 16 of 31 days shown as a cheap month is the single
 * most misleading thing a budget report can do.
 */
export function ConfidenceCard({ confidence }: { confidence: AssessmentDataConfidence }) {
  const { months, excludedMonths, gaps, periodCoveragePct, periodIsPartial, periodDaysElapsed, periodDaysTotal } = confidence;
  const inPeriodGaps = gaps.filter((g) => g.inPeriod);

  return (
    <Section
      icon={ShieldCheck}
      title="Data confidence"
      subtitle="Months below 60% coverage are excluded from every rate, average and trend below."
      aside={
        <Chip tone={periodCoveragePct >= 60 ? "good" : "bad"}>{periodCoveragePct}% logged</Chip>
      }
    >
      <div className="flex gap-1.5">
        {months.map((m) => (
          <div key={m.month} className="flex-1 min-w-0" title={`${m.label}: ${m.daysLogged}/${m.daysInMonth} days logged`}>
            <div className="h-8 rounded bg-cream-200/70 flex items-end overflow-hidden">
              <div
                className={cn("w-full rounded-b transition-all", STATUS_TONE[m.status])}
                style={{ height: `${Math.max(6, m.coveragePct)}%` }}
              />
            </div>
            <p className="text-[9px] text-warm-400 mt-1 text-center truncate">{m.label.split(" ")[0]}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 text-sm">
        {periodIsPartial && (
          <p className="text-warm-500">
            This period is still running — {periodDaysElapsed} of {periodDaysTotal} days. Its totals are a partial
            count, never a trend.
          </p>
        )}
        {excludedMonths.length > 0 ? (
          <p className="text-warm-500">
            <span className="font-medium text-warm-700">{excludedMonths.join(", ")}</span>{" "}
            {excludedMonths.length === 1 ? "was" : "were"} excluded — too few days logged to tell a quiet month from a
            missing one.
          </p>
        ) : (
          <AllClear>Every complete month in the window has enough coverage to trust.</AllClear>
        )}
        {inPeriodGaps.length > 0 && (
          <p className="text-warm-500">
            Longest gap in this period: <span className="font-medium text-warm-700">{inPeriodGaps[0].days} days</span>{" "}
            ({inPeriodGaps[0].from} → {inPeriodGaps[0].to}).
          </p>
        )}
      </div>
    </Section>
  );
}
