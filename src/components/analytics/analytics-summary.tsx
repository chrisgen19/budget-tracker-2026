"use client";

import { TrendingUp, TrendingDown, ArrowLeftRight, Hash } from "lucide-react";
import { cn, formatCurrency, getCurrencySymbol } from "@/lib/utils";
import type { AnalyticsSummary as AnalyticsSummaryType } from "@/types";

interface AnalyticsSummaryProps {
  data: AnalyticsSummaryType;
  currency: string;
  hideAmounts: boolean;
}

export function AnalyticsSummary({ data, currency, hideAmounts }: AnalyticsSummaryProps) {
  const sym = getCurrencySymbol(currency);
  const cards = [
    {
      label: "Income",
      value: data.totalIncome,
      icon: TrendingUp,
      color: "text-income",
      bg: "bg-income-light",
    },
    {
      label: "Expenses",
      value: data.totalExpenses,
      icon: TrendingDown,
      color: "text-expense",
      bg: "bg-expense-light",
    },
    {
      label: "Net Cash Flow",
      value: data.netCashFlow,
      icon: ArrowLeftRight,
      color: data.netCashFlow >= 0 ? "text-income" : "text-expense",
      bg: data.netCashFlow >= 0 ? "bg-income-light" : "bg-expense-light",
    },
    {
      label: "Transactions",
      value: data.transactionCount,
      icon: Hash,
      color: "text-warm-600",
      bg: "bg-cream-100",
      isCount: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="card p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", card.bg)}>
              <card.icon className={cn("w-4 h-4", card.color)} />
            </div>
          </div>
          <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase mb-0.5">
            {card.label}
          </p>
          <p className={cn("text-lg font-serif", card.color)}>
            {card.isCount
              ? data.transactionCount.toLocaleString()
              : hideAmounts
                ? `${sym} ••••••`
                : formatCurrency(card.value, currency)}
          </p>
        </div>
      ))}
    </div>
  );
}
