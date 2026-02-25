"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import type { ReceiptBreakdownMeta } from "@/types";

interface ReceiptBreakdownProps {
  breakdown: ReceiptBreakdownMeta;
  currency: string;
}

export function ReceiptBreakdown({ breakdown, currency }: ReceiptBreakdownProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-cream-200 bg-cream-50/60 mb-5">
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
                  {item.description}
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
