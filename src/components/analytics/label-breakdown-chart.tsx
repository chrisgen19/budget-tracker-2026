"use client";

import type { AnalyticsLabelItem } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";

interface LabelBreakdownChartProps {
  data: AnalyticsLabelItem[];
  currency: string;
  hideAmounts: boolean;
}

export function LabelBreakdownChart({ data, currency, hideAmounts }: LabelBreakdownChartProps) {
  const labeled = data.filter((d) => d.id !== "unlabeled");

  if (labeled.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-warm-300 text-sm">
        No labeled transactions in this period
      </div>
    );
  }

  const maxAmount = Math.max(...labeled.map((d) => d.amount));
  const sym = getCurrencySymbol(currency);

  return (
    <div className="space-y-3 max-h-[460px] overflow-y-auto">
      {labeled.map((item) => {
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

            {/* Progress bar */}
            <div className="h-2 bg-cream-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${barWidth}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
