"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import type { AnalyticsCategoryItem } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { ChartTooltipCard } from "@/components/analytics/chart-tooltip";
import { ChartEmptyState } from "@/components/analytics/chart-empty-state";
import { DrillDownLink, drillDownLabel } from "@/components/analytics/drill-down-link";
import { buildTransactionsHref } from "@/lib/transaction-filter-url";

/**
 * Split the breakdown row's id back into the two things it is made of.
 *
 * `/api/analytics` keys this list by `${categoryId}:${type}`, because one category
 * can carry both income and expense transactions and ALL mode has to show those as
 * separate rows. Passing that composite straight through as `categoryId` matches no
 * row in the database and the drill-down lands on an empty list rather than an
 * error — so the split has to happen here. `lastIndexOf` in case an id ever
 * contains a colon of its own; the type suffix is always the final segment.
 */
export function parseCategoryItemId(id: string): { categoryId: string; type?: "INCOME" | "EXPENSE" } {
  const separator = id.lastIndexOf(":");
  if (separator === -1) return { categoryId: id };
  const suffix = id.slice(separator + 1);
  if (suffix !== "INCOME" && suffix !== "EXPENSE") return { categoryId: id };
  return { categoryId: id.slice(0, separator), type: suffix };
}

interface CategoryBreakdownChartProps {
  data: AnalyticsCategoryItem[];
  currency: string;
  hideAmounts: boolean;
  /** The analytics period, carried into the list so a drill-down shows this number's rows. */
  range: { from: string; to: string };
}

export function CategoryBreakdownChart({ data, currency, hideAmounts, range }: CategoryBreakdownChartProps) {
  // The type travels with the category: in ALL mode the same category can appear
  // as two rows, one income and one expense, and a drill-down that dropped the
  // type would merge them back together and contradict the number just tapped.
  const hrefFor = (item: AnalyticsCategoryItem) => {
    const { categoryId, type } = parseCategoryItemId(item.id);
    // The row carries the same type the id encodes, so it stands in if the id
    // ever arrives without a suffix. Dropping the type there would silently widen
    // the destination to the category's rows of *both* types.
    return buildTransactionsHref({
      categoryId,
      type: type ?? item.type,
      from: range.from,
      to: range.to,
    });
  };

  if (data.length === 0) {
    return <ChartEmptyState icon={PieChartIcon} message="No data for this period" hint="Try a wider date range or add transactions" />;
  }

  const sym = getCurrencySymbol(currency);
  const total = data.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
      {/* Donut chart with centered total */}
      <div className="relative w-[180px] h-[180px] mx-auto sm:mx-0 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={85}
              paddingAngle={2}
              stroke="#FFFFFF"
              strokeWidth={1.5}
            >
              {/* Deliberately not clickable. The ring is 27px thick and a 1%
                  category is a sliver of arc, well under the 44px minimum, and a
                  tap on a slice is how the tooltip is read on touch — navigating
                  away would take the chart's only touch interaction to reach a
                  destination the row beside it already offers. */}
              {data.map((entry) => (
                <Cell key={entry.id} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload as AnalyticsCategoryItem;
                return (
                  <ChartTooltipCard>
                    <p className="text-sm font-medium text-warm-600">{item.name}</p>
                    <p className="text-xs text-warm-400">
                      {hideAmounts ? `${sym} ••••••` : formatCurrency(item.amount, currency)} ({item.percentage}%)
                    </p>
                    <p className="text-xs text-warm-300">{item.transactionCount} transactions</p>
                  </ChartTooltipCard>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-serif text-base text-warm-700 max-w-[100px] truncate">
            {hideAmounts ? `${sym} ••••` : formatCurrency(total, currency)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-warm-400">total</span>
        </div>
      </div>

      {/* Category list */}
      <div className="flex-1 space-y-1 max-h-[240px] overflow-y-auto min-w-0">
        {data.map((item) => (
          <DrillDownLink
            key={item.id}
            href={hrefFor(item)}
            label={drillDownLabel(item.transactionCount, item.name)}
            className="flex items-center gap-3 px-1.5 py-1.5"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: item.color + "1A" }}
            >
              <CategoryIcon name={item.icon} className="w-4 h-4" style={{ color: item.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-warm-600 truncate">{item.name}</p>
              <p className="text-xs text-warm-300">
                {item.transactionCount} {item.transactionCount === 1 ? "txn" : "txns"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-medium text-warm-700 tabular-nums">
                {hideAmounts ? `${sym} ••••••` : formatCurrency(item.amount, currency)}
              </p>
              <p className="text-xs text-warm-400 tabular-nums">{item.percentage}%</p>
            </div>
          </DrillDownLink>
        ))}
      </div>
    </div>
  );
}
