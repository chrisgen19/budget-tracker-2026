"use client";

import { Activity, Radar } from "lucide-react";
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
 *
 * Only period-scoped findings belong under this title. A missed bill is judged
 * against its own payment history, so listing it here dated a live overdue bill
 * to whichever period was open (#340); it has its own card, `MissedBillsCard`,
 * which says what date it is true as of.
 */
export function PatternsCard({ anomalies: all, fmt }: { anomalies: AssessmentAnomaly[]; fmt: Money }) {
  const anomalies = all.filter((a) => a.scope === "period");
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
        <FindingList anomalies={anomalies} fmt={fmt} />
      )}
    </Section>
  );
}

/** Missed bills are outstanding too, and `MissedBillsCard` above already says so at length. */
const HAS_ITS_OWN_CARD: ReadonlySet<AssessmentAnomaly["kind"]> = new Set(["missed-bill"]);

/**
 * Findings the selected period does not bound — true as of today, whichever report is open.
 *
 * Without this card they appear on the Watchlist tab and nowhere else: `PatternsCard` filters them
 * out by design, so a recurring charge that stopped, a bill due next week or a savings goal off
 * pace would simply not exist on this tab. A card of its own rather than a second list inside
 * `PatternsCard`, because the two answer different questions and one heading cannot cover both.
 */
export function OutstandingCard({ anomalies: all, fmt }: { anomalies: AssessmentAnomaly[]; fmt: Money }) {
  const anomalies = all.filter((a) => a.scope === "outstanding" && !HAS_ITS_OWN_CARD.has(a.kind));
  if (anomalies.length === 0) return null;
  return (
    <Section
      icon={Radar}
      title="Open, whichever period is shown"
      subtitle="Measured against today rather than the selected dates."
      aside={<Chip tone={anomalies[0].severity === "high" ? "bad" : "warn"}>{anomalies.length} open</Chip>}
    >
      <FindingList anomalies={anomalies} fmt={fmt} />
    </Section>
  );
}

function FindingList({ anomalies, fmt }: { anomalies: AssessmentAnomaly[]; fmt: Money }) {
  return (
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
  );
}
