"use client";

import { CalendarClock, AlertOctagon, Link2Off } from "lucide-react";
import { Section, Chip, AllClear, type Money } from "./section";
import type { AssessmentBillAccuracy, AssessmentBillFacts } from "@/types";

const VERDICT_COPY: Record<AssessmentBillAccuracy["verdict"], { tone: "good" | "warn" | "bad" | "neutral"; label: string; note: string }> = {
  ok: { tone: "good", label: "On budget", note: "The budgeted figure matches what it costs." },
  "under-budgeted": { tone: "bad", label: "Under-budgeted", note: "It costs more than the bill says, so every forecast using it is short." },
  "over-budgeted": { tone: "warn", label: "Over-budgeted", note: "It costs less than the bill says — the surplus is money you already have." },
  // Not a misconfiguration: the budget is genuinely right for part of the year.
  seasonal: { tone: "neutral", label: "Varies by season", note: "A metered bill: no single figure fits, so the forecast is derived from its own history." },
  "no-payments": { tone: "neutral", label: "No payments yet", note: "Nothing has been paid against it, so there is nothing to check the figure against." },
};

/**
 * Bills that came due and were never settled.
 *
 * A missed occurrence is not the same as an overdue one: the app's `nextDueDate`
 * only stalls when nothing was recorded, so this counts the due dates that
 * passed with no payment, skip or snooze against them. It deliberately offers
 * both readings — an unlogged payment and an unpaid bill look identical here,
 * and only the user knows which it was.
 */
export function MissedBillsCard({ bills, fmt }: { bills: AssessmentBillFacts; fmt: Money }) {
  const { missed, unlinkedPayments } = bills;
  const occurrences = missed.reduce((n, b) => n + b.missedDueDates.length, 0);

  return (
    <Section
      icon={AlertOctagon}
      title="Missed bills"
      subtitle={`Due dates passed with nothing recorded, as of ${bills.asOf}.`}
      aside={missed.length > 0 ? <Chip tone="bad">{occurrences} due date{occurrences > 1 ? "s" : ""}</Chip> : <Chip tone="good">All settled</Chip>}
    >
      {missed.length === 0 ? (
        <AllClear>Every bill that came due has been paid, skipped or snoozed.</AllClear>
      ) : (
        <ul className="space-y-3">
          {missed.map((b) => (
            <li key={b.id} className="p-3 rounded-xl bg-expense-light/40">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-warm-700 truncate">{b.description}</p>
                <span className="text-xs text-expense-dark shrink-0">
                  {b.isEstimate && "~"}{fmt(b.estimatedArrears)}
                </span>
              </div>
              <p className="text-sm text-warm-500 mt-1">
                {b.missedDueDates.length} due date{b.missedDueDates.length > 1 ? "s" : ""} unsettled since{" "}
                {b.missedDueDates[0]} — {b.daysOverdue} days ago.
                {b.isEstimate && " The figure is derived from past payments, not a sum owed."}
              </p>
              <p className="text-xs text-warm-400 mt-1">
                {b.missedDueDates.slice(0, 6).join(" · ")}
                {b.missedDueDates.length > 6 && ` +${b.missedDueDates.length - 6} more`}
              </p>
            </li>
          ))}
        </ul>
      )}

      {unlinkedPayments.length > 0 && (
        <div className="mt-4 pt-3 border-t border-cream-200/70">
          <div className="flex items-center gap-2 mb-2">
            <Link2Off className="w-3.5 h-3.5 text-warm-400" />
            <p className="text-[11px] font-medium tracking-wider text-warm-400 uppercase">Paid outside the bill</p>
          </div>
          <ul className="space-y-1.5">
            {unlinkedPayments.map((u) => (
              <li key={u.billId} className="text-sm text-warm-500">
                <span className="font-medium text-warm-700">{u.billDescription}</span> — {u.count} payment
                {u.count > 1 ? "s" : ""} ({fmt(u.total)}) recorded by hand, so the schedule never advanced.
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

/** Budgeted against actually paid, with a metered bill kept apart from a wrong figure. */
export function BillAccuracyCard({ bills, fmt }: { bills: AssessmentBillFacts; fmt: Money }) {
  const notable = bills.accuracy.filter((b) => b.verdict !== "ok" && b.verdict !== "no-payments");
  const rows = notable.length > 0 ? notable : bills.accuracy.slice(0, 3);
  if (rows.length === 0) return null;

  return (
    <Section
      icon={CalendarClock}
      title="Bill accuracy"
      subtitle="What each bill is budgeted at, against what it has actually cost."
      aside={
        bills.dueSoonCount > 0 ? (
          <span className="text-xs text-warm-400">
            {bills.dueSoonCount} due in 14 days · {bills.dueSoonIsEstimate && "~"}{fmt(bills.dueSoonTotal)}
          </span>
        ) : undefined
      }
    >
      {notable.length === 0 && <AllClear>Every bill is within 15% of what it actually costs.</AllClear>}
      <ul className="space-y-3 mt-2">
        {rows.map((b) => {
          const copy = VERDICT_COPY[b.verdict];
          return (
            <li key={b.id} className="p-3 rounded-xl bg-cream-50/60">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-warm-700 truncate">{b.description}</p>
                <Chip tone={copy.tone}>{copy.label}</Chip>
              </div>
              <p className="text-xs text-warm-400 mt-1">
                Budgeted {fmt(b.budgeted)} · paid {fmt(b.lowest)}–{fmt(b.highest)} across {b.payments} payment
                {b.payments === 1 ? "" : "s"}
                {b.variancePct !== null && ` · average ${b.variancePct > 0 ? "+" : ""}${b.variancePct}%`}
              </p>
              <p className="text-sm text-warm-500 mt-1">{copy.note}</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
