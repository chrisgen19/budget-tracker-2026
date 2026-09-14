"use client";

import { maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { CategoryIcon } from "@/components/ui/icon-map";
import type { CardCategorySpendView } from "@/hooks/use-credit-accounts";

/**
 * What a card was spent on in one month, by category.
 *
 * The same purchases already count in the dashboard and analytics, since each is an ordinary
 * expense; this narrows the view to the one card.
 */
export function CardCategoryBreakdown({ rows }: { rows: CardCategorySpendView[] }) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();

  if (rows.length === 0) {
    return <p className="text-sm text-warm-400">No charges this month.</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.categoryId}>
          <div className="flex items-center gap-2 text-sm">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${row.color}18` }}
            >
              <CategoryIcon name={row.icon} className="h-3.5 w-3.5" style={{ color: row.color }} />
            </span>
            <span className="min-w-0 flex-1 truncate text-warm-600">{row.name}</span>
            <span className="shrink-0 text-xs text-warm-400">{row.percentage}%</span>
            <span className="shrink-0 font-medium text-warm-700">
              {maskCurrency(row.amount, user.currency, hideAmounts)}
            </span>
          </div>
          <div className="ml-9 mt-1.5 h-1.5 overflow-hidden rounded-full bg-cream-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${row.percentage}%`, backgroundColor: row.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
