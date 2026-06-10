"use client";

import { Trophy } from "lucide-react";
import { cn, formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { ChartEmptyState } from "@/components/analytics/chart-empty-state";
import type { AnalyticsTopTransaction } from "@/types";

interface TopTransactionsProps {
  data: AnalyticsTopTransaction[];
  currency: string;
  hideAmounts: boolean;
}

export function TopTransactions({ data, currency, hideAmounts }: TopTransactionsProps) {
  if (data.length === 0) {
    return <ChartEmptyState icon={Trophy} message="No transactions this period" hint="Your largest transactions will show up here" />;
  }

  const sym = getCurrencySymbol(currency);

  return (
    <div className="divide-y divide-cream-100">
      {data.map((t, i) => (
        <div key={t.id} className="flex items-center gap-3 py-3 min-h-[56px] first:pt-0 last:pb-0">
          <span className="font-serif text-xs text-warm-300 w-5 text-center shrink-0">{i + 1}</span>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: t.categoryColor + "18" }}
          >
            <CategoryIcon name={t.categoryIcon} className="w-4 h-4" style={{ color: t.categoryColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-warm-600 truncate">{t.description}</p>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs text-warm-300 shrink-0">{t.categoryName}</span>
              {t.labels.map((label) => (
                <span
                  key={label.id}
                  className="text-[10px] px-1.5 py-px rounded-full truncate"
                  style={{ backgroundColor: label.color + "1A", color: label.color }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p
              className={cn(
                "font-display font-semibold tabular-nums text-sm",
                t.type === "INCOME" ? "text-income" : "text-expense"
              )}
            >
              {t.type === "INCOME" ? "+" : "−"}
              {hideAmounts ? `${sym} ••••••` : formatCurrency(t.amount, currency)}
            </p>
            <p className="text-xs text-warm-300">{t.dateLabel}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
