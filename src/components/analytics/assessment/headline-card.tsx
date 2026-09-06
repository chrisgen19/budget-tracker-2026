"use client";

import { Landmark } from "lucide-react";
import { Section, Chip, type Money } from "./section";
import type { AssessmentHeadline } from "@/types";

/**
 * The figures worth reading before any of the detail.
 *
 * Runway is the one the app never showed anywhere: what the balance covers at the
 * pace of the months that were actually logged. It divides by the trustworthy
 * months only, so a month with the data missing cannot flatter it into a longer
 * runway than there is.
 */
export function HeadlineCard({ headline, fmt }: { headline: AssessmentHeadline; fmt: Money }) {
  if (headline.months === 0) return null;
  const { savingsRatePct, monthsOfRunway } = headline;

  return (
    <Section
      icon={Landmark}
      title="Where you stand"
      subtitle={`Averaged over the ${headline.months} month${headline.months === 1 ? "" : "s"} with enough data to trust.`}
      aside={
        savingsRatePct !== null ? (
          <Chip tone={savingsRatePct >= 20 ? "good" : savingsRatePct > 0 ? "warn" : "bad"}>{savingsRatePct}% kept</Chip>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">Balance</dt>
          <dd className="text-sm font-medium text-warm-700 mt-0.5">{fmt(headline.runningBalance)}</dd>
          <p className="text-[11px] text-warm-400">everything logged</p>
        </div>
        <div>
          <dt className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">Monthly burn</dt>
          <dd className="text-sm font-medium text-warm-700 mt-0.5">{fmt(headline.avgMonthlyBurn)}</dd>
          <p className="text-[11px] text-warm-400">typical month</p>
        </div>
        <div>
          <dt className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">Runway</dt>
          <dd className="text-sm font-medium text-warm-700 mt-0.5">
            {monthsOfRunway === null ? "—" : `${monthsOfRunway} mo`}
          </dd>
          <p className="text-[11px] text-warm-400">at that pace</p>
        </div>
      </dl>
    </Section>
  );
}
