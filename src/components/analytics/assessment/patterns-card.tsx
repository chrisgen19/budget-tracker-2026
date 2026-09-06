"use client";

import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { Section, Chip, SEVERITY_STYLES, AllClear, type Money } from "./section";
import type { AssessmentAnomaly } from "@/types";

/** Anomalies that describe the data rather than the spending get a quieter frame. */
const IS_ACCURACY: ReadonlySet<AssessmentAnomaly["kind"]> = new Set(["duplicate", "logging-gap"]);

/**
 * What this period did that the baseline months say it should not have.
 *
 * Computed, not written by the model: each row is arithmetic against the
 * trustworthy months, so the figure beside it can be checked. The AI's reading
 * of these appears separately, under "What stood out".
 */
export function PatternsCard({ anomalies, fmt }: { anomalies: AssessmentAnomaly[]; fmt: Money }) {
  return (
    <Section
      icon={Activity}
      title="What changed this period"
      subtitle="Measured against the months with enough data to trust."
      aside={anomalies.length > 0 ? <Chip tone={anomalies[0].severity === "high" ? "bad" : "warn"}>{anomalies.length} found</Chip> : undefined}
    >
      {anomalies.length === 0 ? (
        <AllClear>Nothing out of the ordinary — this period tracks the baseline months.</AllClear>
      ) : (
        <ul className="space-y-3">
          {anomalies.map((a, i) => {
            const sev = SEVERITY_STYLES[a.severity];
            return (
              <li key={`${a.kind}-${i}`} className="flex gap-3">
                <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", sev.dot)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-warm-700">{a.title}</p>
                    {a.current !== null && (
                      <span className={cn("text-xs shrink-0", IS_ACCURACY.has(a.kind) ? "text-warm-400" : sev.text)}>
                        {a.kind === "logging-gap" ? `${a.current}%` : fmt(a.current)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-warm-500">{a.detail}</p>
                  {a.baseline !== null && !IS_ACCURACY.has(a.kind) && (
                    <p className="text-xs text-warm-400 mt-0.5">
                      Usual: {fmt(a.baseline)}
                      {a.changePct !== null && ` · ${a.changePct > 0 ? "+" : ""}${a.changePct}%`}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
