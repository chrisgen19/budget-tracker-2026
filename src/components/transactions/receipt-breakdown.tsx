"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import type { ReceiptBreakdownMeta } from "@/types";

/**
 * Narrow a value read straight out of `transactions.receipt_breakdown` into the shape this
 * component renders, or `null` when it cannot be trusted.
 *
 * The column only gained a write-side schema in #119, so rows written before that could hold
 * anything, and this component reads `breakdown.items.length` with no guard. Callers holding
 * a database value narrow through here instead of asserting the type with a cast.
 *
 * Deliberately duplicated rather than shared with `parseReceiptBreakdown` in
 * `budget-queries.ts`: that module imports Prisma as a value and must not reach a client
 * bundle.
 */
export function toReceiptBreakdownMeta(raw: unknown): ReceiptBreakdownMeta | null {
  if (typeof raw !== "object" || raw === null) return null;

  const blob = raw as Record<string, unknown>;
  if (!Array.isArray(blob.items)) return null;

  const items: ReceiptBreakdownMeta["items"] = [];
  for (const entry of blob.items) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name, amount } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof amount !== "number" || !Number.isFinite(amount)) {
      continue;
    }
    items.push({ name, amount });
  }

  if (items.length === 0) return null;

  const total =
    typeof blob.total === "number" && Number.isFinite(blob.total)
      ? blob.total
      : items.reduce((sum, i) => sum + i.amount, 0);

  return { total, items };
}

interface ReceiptBreakdownProps {
  breakdown: ReceiptBreakdownMeta;
  currency: string;
  /** Initial expanded state. Defaults to collapsed: a breakdown may carry up to
   *  MAX_BREAKDOWN_LINE_ITEMS rows per group, which is too much to paint on open in either
   *  caller — the transaction modal or the multi-scan list. */
  defaultExpanded?: boolean;
}

export function ReceiptBreakdown({ breakdown, currency, defaultExpanded = false }: ReceiptBreakdownProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50/60">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-warm-600">
          Receipt Breakdown
          <span className="ml-1.5 text-warm-300 font-normal">
            ({breakdown.items.length} item{breakdown.items.length !== 1 ? "s" : ""})
          </span>
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-warm-400 transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div className="border-t border-cream-200">
          {/* Items */}
          <div className="divide-y divide-cream-100">
            {breakdown.items.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between gap-3 px-4 py-2.5"
              >
                <p className="text-sm text-warm-500 leading-snug min-w-0">
                  {item.name}
                </p>
                <span className="text-sm font-medium text-warm-600 tabular-nums shrink-0">
                  {formatCurrency(item.amount, currency)}
                </span>
              </div>
            ))}
          </div>

          {/* Total footer */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-cream-200 bg-cream-100/50">
            <span className="text-sm font-semibold text-warm-600">Total</span>
            <span className="text-sm font-semibold text-warm-700 tabular-nums">
              {formatCurrency(breakdown.total, currency)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
