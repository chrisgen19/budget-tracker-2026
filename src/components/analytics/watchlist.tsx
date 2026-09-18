"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardCheck,
  Clock3,
  RefreshCw,
} from "lucide-react";
import {
  useAssessmentFactsQuery,
  useWatchlistFindingAction,
  type AssessmentPeriod,
} from "@/hooks/use-assessment";
import { useToast } from "@/components/ui/toast";
import { buildTransactionsHref } from "@/lib/transaction-filter-url";
import { cn } from "@/lib/utils";
import { watchlistFindingKey } from "@/lib/watchlist-findings";
import type {
  AssessmentAnomaly,
  AssessmentAnomalyScope,
} from "@/types";

interface WatchlistProps {
  period: AssessmentPeriod;
  returnTo: string;
}

const KIND_LABEL: Record<AssessmentAnomaly["kind"], string> = {
  "budget-threshold": "Budget threshold",
  "budget-forecast": "Budget forecast",
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
  "recurring-new": "New recurring charge",
  "recurring-ended": "Recurring charge stopped",
  "recurring-amount-change": "Recurring charge changed",
  "recurring-renews-soon": "Renews soon",
  "bill-due-soon": "Bill due soon",
  "bill-snoozed": "Bill put off",
  "bill-under-budgeted": "Bill costs more than budgeted",
  "missing-expected-income": "Expected income not logged",
  "low-coverage": "Data coverage",
  "insufficient-history": "Not enough history",
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

interface ScopeSectionCopy {
  scope: AssessmentAnomalyScope;
  heading: string;
  blurb: string;
  /** Shown when the group has no findings, or `null` to leave the group out entirely. */
  empty: string | null;
}

/**
 * The two groups, in the order they are shown.
 *
 * The panel used to put every finding under "findings from this period", which is false for a
 * missed bill: bills are judged against their own payment history, so opening February 2019, a
 * month with no transactions, reported a live 2026 overdue bill as though it belonged there
 * (#340).
 *
 * The period group comes first because it is what the user selected, and it is shown even when
 * empty: with an outstanding bill on the account the panel is never empty as a whole, so without
 * its own message a clean period would only be implied by a missing heading.
 */
const SCOPE_SECTIONS: readonly ScopeSectionCopy[] = [
  {
    scope: "period",
    heading: "In this period",
    blurb: "Measured inside the dates shown.",
    empty: "No unusual spending, possible duplicates or logging gaps in these dates.",
  },
  {
    scope: "outstanding",
    heading: "Outstanding",
    blurb: "Still open today, whichever period is shown.",
    empty: null,
  },
];

/**
 * Which group a finding belongs in. Anything not positively marked as period-scoped goes to
 * Outstanding, so a finding is never dropped and never claimed for a period it was not measured in.
 */
const groupOf = (finding: AssessmentAnomaly): AssessmentAnomalyScope =>
  finding.scope === "period" ? "period" : "outstanding";

const findingHref = (
  finding: AssessmentAnomaly,
  period: AssessmentPeriod,
  returnTo: string,
): string => {
  const drillDown = finding.drillDown;
  if (drillDown?.destination === "bills" || finding.kind === "missed-bill") return "/bills";
  return buildTransactionsHref({
    type: drillDown?.type,
    categoryId: drillDown?.categoryId,
    search: drillDown?.search,
    from: drillDown?.from ?? period.from,
    to: drillDown?.to ?? period.to,
    ret: returnTo,
  });
};

function ActionLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-amber-dark transition-colors hover:bg-amber-light",
        className,
      )}
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

function Finding({
  finding,
  period,
  returnTo,
}: {
  finding: AssessmentAnomaly;
  period: AssessmentPeriod;
  returnTo: string;
}) {
  const severity = SEVERITY_STYLE[finding.severity];
  const findingAction = useWatchlistFindingAction();
  const { showToast } = useToast();
  const key = watchlistFindingKey(finding, period);
  const saveAction = async (nextAction: "RESOLVED" | "SNOOZED") => {
    try {
      await findingAction.mutateAsync({ findingKey: key, action: nextAction });
      showToast(nextAction === "RESOLVED" ? "Finding resolved" : "Finding snoozed for 7 days");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save Watchlist action", "error");
    }
  };
  return (
    <li className="p-4 sm:p-5">
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
      <h4 className="mt-2 text-sm font-medium text-warm-700">
        {finding.title}
      </h4>
      <p className="mt-1 text-sm leading-6 text-warm-500">{finding.detail}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <ActionLink
          href={findingHref(finding, period, returnTo)}
          className="-mb-2 -ml-2"
        >
          {finding.drillDown?.destination === "bills" || finding.kind === "missed-bill"
            ? "Go to Bills"
            : "View transactions"}
        </ActionLink>
        <button
          type="button"
          onClick={() => void saveAction("RESOLVED")}
          disabled={findingAction.isPending}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-income hover:bg-income-light disabled:opacity-50"
        >
          <Check className="h-4 w-4" /> Resolve
        </button>
        <button
          type="button"
          onClick={() => void saveAction("SNOOZED")}
          disabled={findingAction.isPending}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-warm-600 hover:bg-cream-100 disabled:opacity-50"
        >
          <Clock3 className="h-4 w-4" /> Snooze 7 days
        </button>
      </div>
    </li>
  );
}

function ScopeSection({
  id,
  copy,
  findings,
  footer,
  period,
  returnTo,
}: {
  id: string;
  copy: ScopeSectionCopy;
  findings: AssessmentAnomaly[];
  /** A link that belongs to this group rather than to the whole panel. */
  footer?: ReactNode;
  period: AssessmentPeriod;
  returnTo: string;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="border-b border-cream-200 bg-cream-50/50 px-4 py-2 sm:px-5">
        <h3
          id={id}
          className="text-[11px] font-medium uppercase tracking-wider text-warm-500"
        >
          {copy.heading}
        </h3>
        <p className="text-xs text-warm-400">{copy.blurb}</p>
      </div>
      {findings.length === 0 ? (
        <p className="p-4 text-sm text-warm-400 sm:p-5">{copy.empty}</p>
      ) : (
        <ul className="divide-y divide-cream-200/80">
          {findings.map((finding, index) => (
            <Finding
              key={`${finding.kind}-${index}`}
              finding={finding}
              period={period}
              returnTo={returnTo}
            />
          ))}
        </ul>
      )}
      {footer && (
        <div className="border-t border-cream-200/80 px-2 py-1 sm:px-3">
          {footer}
        </div>
      )}
    </section>
  );
}

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
 * the AI Assessment tab. They are live aggregates; Resolve and Snooze keep
 * their state separately, without mutating the underlying facts.
 */
export function Watchlist({ period, returnTo }: WatchlistProps) {
  const sectionId = useId();
  const facts = useAssessmentFactsQuery(period);
  const findings = facts.data?.facts.anomalies ?? [];
  const factsPeriod = facts.data?.facts.period ?? period;
  const findingStates = facts.data?.findingStates ?? {};
  const activeFindings = findings.filter(
    (finding) => findingStates[watchlistFindingKey(finding, factsPeriod)] === undefined,
  );
  // The drill-down opens the selected dates, so it sits with the findings measured inside them.
  // At the bottom of the panel it also read as the way to act on an outstanding bill, and on a
  // month with nothing logged it opened an empty list.
  const periodLink = (
    <ActionLink href={transactionHref(period, returnTo)}>
      View transactions in this period
    </ActionLink>
  );

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
              Live, measured findings. No AI generation is needed.
            </p>
          </div>
        </div>
      </div>

      {activeFindings.length === 0 ? (
        <div className="p-8 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-income" />
          <h3 className="mt-3 font-serif text-lg text-warm-700">
            Nothing needs attention
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-warm-400">
            No active unusual spending, possible duplicates or logging gaps in
            this period, and no bills outstanding today.
          </p>
          <div className="mt-3">{periodLink}</div>
        </div>
      ) : (
        <div className="divide-y divide-cream-200">
          {SCOPE_SECTIONS.map((copy) => {
            const inGroup = activeFindings.filter((f) => groupOf(f) === copy.scope);
            if (inGroup.length === 0 && copy.empty === null) return null;
            return (
              <ScopeSection
                key={copy.scope}
                id={`${sectionId}-${copy.scope}`}
                copy={copy}
                findings={inGroup}
                footer={copy.scope === "period" ? periodLink : undefined}
                period={factsPeriod}
                returnTo={returnTo}
              />
            );
          })}
        </div>
      )}

    </section>
  );
}
