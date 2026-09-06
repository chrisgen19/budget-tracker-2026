"use client";

import { Landmark } from "lucide-react";
import { Section, Chip, type Money } from "./section";
import type { AssessmentHeadline } from "@/types";

/**
 * The figures worth reading before any of the detail.
 *
 * Rendered even when no month passed the coverage gate. That case is a new
 * account or one whose logging has lapsed — exactly the reader for whom the
 * balance is the only trustworthy figure on the page, so hiding the card to
 * avoid showing an empty burn would withhold the one number that still means
 * something. The rates simply read as unknown.
 *
 * Runway is the figure the app never showed anywhere: what the balance covers
 * **if income stopped**. That is the ordinary meaning of the word and why it
 * divides by gross spending rather than by net — but it is also why the label
 * has to say so, or a healthy saver reads a growing balance as a countdown.
 */
export function HeadlineCard({ headline, fmt }: { headline: AssessmentHeadline; fmt: Money }) {
  const { savingsRatePct, monthsOfRunway, months } = headline;

  return (
    <Section
      icon={Landmark}
      title="Where you stand"
      subtitle={
        months === 0
          ? "No month in this window has enough logging to average — the balance is still real."
          : `Averaged over the ${months} month${months === 1 ? "" : "s"} with enough data to trust.`
      }
      aside={
        savingsRatePct !== null ? (
          <Chip tone={savingsRatePct >= 20 ? "good" : savingsRatePct > 0 ? "warn" : "bad"}>{savingsRatePct}% kept</Chip>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-4">
        <div className="min-w-0">
          <dt className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">Balance</dt>
          <dd className="text-sm font-medium text-warm-700 mt-0.5 truncate">{fmt(headline.runningBalance)}</dd>
          <p className="text-[11px] text-warm-400">everything logged</p>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">Monthly burn</dt>
          <dd className="text-sm font-medium text-warm-700 mt-0.5 truncate">{fmt(headline.avgMonthlyBurn)}</dd>
          <p className="text-[11px] text-warm-400">typical month</p>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">Runway</dt>
          <dd className="text-sm font-medium text-warm-700 mt-0.5">
            {monthsOfRunway === null ? "—" : `${monthsOfRunway} mo`}
          </dd>
          <p className="text-[11px] text-warm-400">if income stopped</p>
        </div>
      </dl>
    </Section>
  );
}
