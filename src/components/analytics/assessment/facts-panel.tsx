"use client";

import { motion } from "framer-motion";
import { stagger } from "@/components/analytics/motion-variants";
import { formatCurrency } from "@/lib/utils";
import { HeadlineCard } from "./headline-card";
import { ConfidenceCard } from "./confidence-card";
import { PatternsCard } from "./patterns-card";
import { MissedBillsCard, BillAccuracyCard } from "./bills-card";
import { TrendsCard, RecurringCard } from "./trends-card";
import { HygieneCard } from "./hygiene-card";
import type { Money } from "./section";
import type { AssessmentFacts } from "@/types";

interface FactsPanelProps {
  facts: AssessmentFacts | undefined;
  isLoading: boolean;
  isError: boolean;
  currency: string;
  hideAmounts: boolean;
}

/**
 * The measured half of the assessment.
 *
 * Rendered whether or not a report has been generated, and computed fresh on
 * every load rather than cached beside the AI prose: these are the user's own
 * rows, and there is no reason to make someone spend a generation to find out a
 * bill has gone unpaid. The narrative above interprets exactly these figures, so
 * a claim in it can always be checked against the row it came from.
 */
export function AssessmentFactsPanel({ facts, isLoading, isError, currency, hideAmounts }: FactsPanelProps) {
  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-4 sm:p-5 animate-pulse h-32 bg-cream-50/60" />
        ))}
      </div>
    );
  }

  if (isError || !facts) {
    return (
      <div className="card p-4 sm:p-5">
        <p className="text-sm text-warm-500">
          Couldn&apos;t work out the details for this period. The AI summary below still works — reload to try again.
        </p>
      </div>
    );
  }

  const fmt: Money = (value) => (value === null ? "—" : hideAmounts ? "•••" : formatCurrency(value, currency));

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <HeadlineCard headline={facts.headline} fmt={fmt} />
      <ConfidenceCard confidence={facts.confidence} />
      <PatternsCard anomalies={facts.anomalies} fmt={fmt} />
      <MissedBillsCard bills={facts.bills} fmt={fmt} />
      <TrendsCard trends={facts.trends} fmt={fmt} />
      <BillAccuracyCard bills={facts.bills} fmt={fmt} />
      <RecurringCard recurring={facts.recurring} fmt={fmt} />
      <HygieneCard hygiene={facts.hygiene} fmt={fmt} />
    </motion.div>
  );
}
