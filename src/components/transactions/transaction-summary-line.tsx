"use client";

import type { TransactionFilters } from "@/components/transactions/transaction-filters";
import type { TransactionSummary } from "@/hooks/use-transactions";
import { formatCurrency, maskCurrency } from "@/lib/utils";

interface TransactionSummaryLineProps {
  /** Undefined until the first fetch resolves; kept across refetches by placeholderData. */
  summary: TransactionSummary | undefined;
  isError: boolean;
  type: TransactionFilters["type"];
  currency: string;
  hideAmounts: boolean;
}

/** Which side of the ledger the current type filter has already picked. */
const AMOUNT_NOUN: Record<TransactionFilters["type"], string> = {
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
  type: TransactionFilters["type"],
  currency: string,
  hideAmounts: boolean,
) => {
  const value =
    type === "INCOME" ? summary.income : type === "EXPENSE" ? summary.expense : summary.net;
  if (hideAmounts) return maskCurrency(value, currency, true);
  const formatted = formatCurrency(Math.abs(value), currency);
  if (type !== "ALL" || value === 0) return formatted;
  return `${value < 0 ? "−" : "+"}${formatted}`;
};

/**
 * What the current filters add up to, across the whole window rather than the
 * rows that happen to be loaded.
 *
 * This replaces the toolbar's old bare count, which repeated the number the page
 * header was already showing. The count survives here as the second half of the
 * line, because a total with no denominator invites the wrong reading.
 */
export function TransactionSummaryLine({
  summary,
  isError,
  type,
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
      : `${amountText(summary, type, currency, hideAmounts)} ${AMOUNT_NOUN[type]} · ${summary.count.toLocaleString()} ${summary.count === 1 ? "transaction" : "transactions"}`;

  return (
    <p aria-live="polite" className="min-w-0 truncate text-xs font-medium text-warm-400">
      {text}
    </p>
  );
}
