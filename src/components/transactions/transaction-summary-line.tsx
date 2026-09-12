"use client";

import type { TransactionSummary } from "@/hooks/use-transactions";
import { formatCurrency, maskCurrency } from "@/lib/utils";

type SummaryType = TransactionSummary["type"];

interface TransactionSummaryLineProps {
  /** Undefined until the first fetch resolves; kept across refetches by placeholderData. */
  summary: TransactionSummary | undefined;
  isError: boolean;
  currency: string;
  hideAmounts: boolean;
}

/** Which side of the ledger the summary's own type filter had already picked. */
const AMOUNT_NOUN: Record<SummaryType, string> = {
  ALL: "net",
  INCOME: "received",
  EXPENSE: "spent",
};

/**
 * The filtered total, signed only where the sign carries information.
 *
 * A type filter has already chosen a side, so "spent" and "received" need no sign
 * and reading one there would be noise. All mixes both, where the direction of the
 * net is the whole point. Zero takes no sign either: "+₱0.00" reads as an artefact
 * of the arithmetic rather than as a fact about the month.
 */
const amountText = (
  summary: TransactionSummary,
  currency: string,
  hideAmounts: boolean,
) => {
  const { type } = summary;
  const value =
    type === "INCOME" ? summary.income : type === "EXPENSE" ? summary.expense : summary.net;
  if (hideAmounts) return maskCurrency(value, currency, true);
  const formatted = formatCurrency(Math.abs(value), currency);
  if (type !== "ALL" || value === 0) return formatted;
  return `${value < 0 ? "−" : "+"}${formatted}`;
};

/**
 * What the filters add up to, across the whole window rather than the rows that
 * happen to be loaded.
 *
 * This replaces the toolbar's old bare count, which repeated the number the page
 * header was already showing. The count survives here as the second half of the
 * line, because a total with no denominator invites the wrong reading.
 *
 * The type is read off the summary and never off the live filters. They disagree
 * whenever a filter change is still in flight, and the two readings are not
 * equally wrong: the aggregate runs over a WHERE that already applied the type, so
 * an expense summary reports `income: 0` meaning "excluded". Interpreted under a
 * freshly-pressed Income that renders as "₱0.00 received" — a confident wrong
 * answer, held for as long as the request takes. Reading the summary's own type
 * instead shows the previous line unchanged until the new one lands, which is what
 * stale data should look like.
 */
export function TransactionSummaryLine({
  summary,
  isError,
  currency,
  hideAmounts,
}: TransactionSummaryLineProps) {
  // A failure after a success keeps the figures that did load: stale totals beat
  // no totals, and every write on this page invalidates them anyway.
  const text = !summary
    ? isError
      ? "Totals unavailable"
      : "Loading…"
    : summary.count === 0
      ? "No transactions"
      : `${amountText(summary, currency, hideAmounts)} ${AMOUNT_NOUN[summary.type]} · ${summary.count.toLocaleString()} ${summary.count === 1 ? "transaction" : "transactions"}`;

  return (
    <p aria-live="polite" className="min-w-0 truncate text-xs font-medium text-warm-400">
      {text}
    </p>
  );
}
