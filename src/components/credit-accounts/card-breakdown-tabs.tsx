"use client";

import { useState } from "react";
import { cn, maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { CardCategoryBreakdown } from "@/components/credit-accounts/card-category-breakdown";
import type { CardCategorySpendView, CardLabelSpendView } from "@/hooks/use-credit-accounts";

function CardLabelBreakdown({ rows }: { rows: CardLabelSpendView[] }) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();

  if (rows.length === 0) return <p className="text-sm text-warm-400">No purchases this month.</p>;

  return (
    <div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="min-w-0 flex-1 truncate text-warm-600">{row.name}</span>
              <span className="shrink-0 text-xs text-warm-400">{row.percentage}%</span>
              <span className="shrink-0 font-medium text-warm-700">
                {maskCurrency(row.amount, user.currency, hideAmounts)}
              </span>
            </div>
            <div className="ml-4.5 mt-1.5 h-1.5 overflow-hidden rounded-full bg-cream-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(row.percentage, 100)}%`, backgroundColor: row.color }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-warm-400">
        A purchase with several labels counts in full under each, so labels can add up to more than
        100%.
      </p>
    </div>
  );
}

const TABS = [
  { id: "category", label: "Category" },
  { id: "label", label: "Label" },
] as const;

interface CardBreakdownTabsProps {
  categories: CardCategorySpendView[];
  labels: CardLabelSpendView[];
}

/** What the card was spent on this month, by category or by label, with the same arithmetic as Analytics. */
export function CardBreakdownTabs({ categories, labels }: CardBreakdownTabsProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("category");

  return (
    <div>
      <div role="tablist" aria-label="Break down by" className="mb-4 flex gap-1 rounded-xl bg-cream-100 p-1">
        {TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={tab === option.id}
            onClick={() => setTab(option.id)}
            className={cn(
              "min-h-11 flex-1 rounded-lg text-sm font-medium transition-colors",
              tab === option.id ? "bg-white text-warm-700 shadow-warm" : "text-warm-400 hover:text-warm-600"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "category" ? <CardCategoryBreakdown rows={categories} /> : <CardLabelBreakdown rows={labels} />}
      </div>
    </div>
  );
}
