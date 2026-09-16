"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  RefreshCw,
} from "lucide-react";
import {
  useAssessmentFactsQuery,
  type AssessmentPeriod,
} from "@/hooks/use-assessment";
import { cn } from "@/lib/utils";
import type { AssessmentAnomaly } from "@/types";

interface WatchlistProps {
  period: AssessmentPeriod;
  returnTo: string;
}

const KIND_LABEL: Record<AssessmentAnomaly["kind"], string> = {
  "category-spike": "Category change",
  "new-category": "New spending",
  "outlier-transaction": "Unusual transaction",
  overspend: "Cash flow",
  "savings-drop": "Savings",
  pace: "Spending pace",
  "missing-income": "Income",
  duplicate: "Possible duplicate",
  "logging-gap": "Data coverage",
  "missed-bill": "Bill follow-up",
};

const SEVERITY_STYLE: Record<
  AssessmentAnomaly["severity"],
  { label: string; className: string }
> = {
  high: {
    label: "Needs attention",
    className: "bg-expense-light text-expense-dark",
  },
  medium: { label: "Review", className: "bg-amber-light text-amber-dark" },
  low: { label: "For awareness", className: "bg-cream-200 text-warm-500" },
};

const transactionHref = (
  period: AssessmentPeriod,
  returnTo: string,
): string => {
  const params = new URLSearchParams({
    period: "custom",
    from: period.from,
    to: period.to,
    ret: returnTo,
  });
  return `/transactions?${params}`;
};

/**
 * Always-available, deterministic findings that used to be visible only inside
 * the AI Assessment tab. They are live aggregates, not notifications: resolving
 * and snoozing them needs a persisted alert-state model and follows in a later
 * slice.
 */
export function Watchlist({ period, returnTo }: WatchlistProps) {
  const facts = useAssessmentFactsQuery(period);
  const findings = facts.data?.facts.anomalies ?? [];
  const href = transactionHref(period, returnTo);

  if (facts.isLoading) {
    return (
      <div
        className="card h-56 animate-pulse bg-cream-50/60"
        aria-busy="true"
      />
    );
  }

  if (facts.isError) {
    return (
      <div className="card p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-expense" />
        <h2 className="mt-3 font-serif text-lg text-warm-700">
          Couldn&apos;t load the Watchlist
        </h2>
        <p className="mt-1 text-sm text-warm-400">
          Your transactions are unchanged. Try loading the live findings again.
        </p>
        <button
          type="button"
          onClick={() => facts.refetch()}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-dark"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-cream-200 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-amber-light p-2 text-amber-dark">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-serif text-xl text-warm-700">Watchlist</h2>
            <p className="mt-1 text-sm text-warm-400">
              Live, measured findings from this period. No AI generation is
              needed.
            </p>
          </div>
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="p-8 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-income" />
          <h3 className="mt-3 font-serif text-lg text-warm-700">
            Nothing needs attention
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-warm-400">
            This period has no unusual patterns, missed bills, possible
            duplicates, or logging gaps to review.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-cream-200/80">
          {findings.map((finding, index) => {
            const severity = SEVERITY_STYLE[finding.severity];
            return (
              <li key={`${finding.kind}-${index}`} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium",
                      severity.className,
                    )}
                  >
                    {severity.label}
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-warm-400">
                    {KIND_LABEL[finding.kind]}
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-medium text-warm-700">
                  {finding.title}
                </h3>
                <p className="mt-1 text-sm leading-6 text-warm-500">
                  {finding.detail}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-cream-200 bg-cream-50/50 p-3 sm:px-5">
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-amber-dark transition-colors hover:bg-amber-light"
        >
          View transactions in this period
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
