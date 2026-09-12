"use client";

import type { TransactionSummary } from "@/hooks/use-transactions";
import { cn, formatCurrency, maskCurrency } from "@/lib/utils";

type SummaryType = TransactionSummary["type"];

interface TransactionSummaryLineProps {
  /** Undefined until the first fetch resolves; kept across refetches by placeholderData. */
  summary: TransactionSummary | undefined;
  isError: boolean;
  /**
   * True while `summary` is the *previous* filter set's answer, carried over by
   * `placeholderData` because this filter set has never resolved.
   *
   * Distinct from ordinary staleness, and the distinction is the whole reason this
   * prop exists. Data cached under the current key is last-good for this view and
   * worth keeping on screen through a failed refetch. Placeholder data describes a
   * different window entirely — another month, another search — and a single number
   * gives the reader no way to tell the two apart.
   */
  isPlaceholder: boolean;
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
 * answer, held for as long as the request takes.
 *
 * That fixes the *reading*, not the provenance. A carried-over summary still
 * answers a question nobody is asking any more — the previous month, the previous
 * search — and one number offers no way to notice. So while it is placeholder data
 * the line is dimmed and marked `aria-busy`, and if the request it is standing in
 * for fails, it gives way to the refusal rather than leaving another window's total
 * on screen indefinitely. Data cached under the *current* filters is a different
 * case and survives a failed refetch: it is the last true answer to this question.
 */
export function TransactionSummaryLine({
  summary,
  isError,
  isPlaceholder,
  currency,
  hideAmounts,
}: TransactionSummaryLineProps) {
  // Nothing usable: either this view has never resolved, or what is held belongs to
  // a different one and the request that would have replaced it failed.
  const unusable = !summary || (isError && isPlaceholder);

  const text = unusable
    ? isError
      ? "Totals unavailable"
      : "Loading…"
    : summary.count === 0
      ? "No transactions"
      : `${amountText(summary, currency, hideAmounts)} ${AMOUNT_NOUN[summary.type]} · ${summary.count.toLocaleString()} ${summary.count === 1 ? "transaction" : "transactions"}`;

  const provisional = !unusable && isPlaceholder;

  return (
    <p
      aria-live="polite"
      aria-busy={provisional || undefined}
      className={cn(
        "min-w-0 truncate text-xs font-medium text-warm-400 transition-opacity",
        provisional && "opacity-50",
      )}
    >
      {text}
    </p>
  );
}
