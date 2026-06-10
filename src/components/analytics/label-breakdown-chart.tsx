"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Tags } from "lucide-react";
import type { AnalyticsLabelItem } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { ChartEmptyState } from "@/components/analytics/chart-empty-state";

const VISIBLE_COUNT = 8;

interface LabelBreakdownChartProps {
  data: AnalyticsLabelItem[];
  currency: string;
  hideAmounts: boolean;
}

export function LabelBreakdownChart({ data, currency, hideAmounts }: LabelBreakdownChartProps) {
  const [showAll, setShowAll] = useState(false);
  const labeled = data.filter((d) => d.id !== "unlabeled");

  if (labeled.length === 0) {
    return <ChartEmptyState icon={Tags} message="No labeled transactions in this period" hint="Add labels to transactions to break down spending" />;
  }

  const maxAmount = Math.max(...labeled.map((d) => d.amount));
  const sym = getCurrencySymbol(currency);
  const visible = showAll ? labeled : labeled.slice(0, VISIBLE_COUNT);
  const hiddenCount = labeled.length - VISIBLE_COUNT;

  return (
    <div className="space-y-3">
      {visible.map((item) => {
        const barWidth = maxAmount > 0 ? (item.amount / maxAmount) * 100 : 0;

        return (
          <div key={item.id} className="space-y-1.5">
            {/* Label name + amount */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-sm text-warm-600 truncate">{item.name}</span>
                <span className="text-xs text-warm-300 shrink-0">
                  {item.transactionCount} {item.transactionCount === 1 ? "txn" : "txns"}
                </span>
              </div>
              <div className="text-right shrink-0 ml-3">
                <span className="text-sm font-medium text-warm-700 tabular-nums">
                  {hideAmounts ? `${sym} ••••••` : formatCurrency(item.amount, currency)}
                </span>
                <span className="text-xs text-warm-400 tabular-nums ml-1.5">
                  {item.percentage}%
                </span>
              </div>
            </div>

            {/* Progress bar (animates in on mount) */}
            <div className="h-2.5 bg-cream-100 rounded-full overflow-hidden border border-cream-200/60">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${barWidth}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="h-full rounded-full"
                style={{ backgroundColor: item.color }}
              />
            </div>
          </div>
        );
      })}

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="w-full py-2.5 px-3 rounded-lg text-xs text-amber hover:text-amber-dark hover:bg-cream-50 font-medium transition-colors"
        >
          {showAll ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
