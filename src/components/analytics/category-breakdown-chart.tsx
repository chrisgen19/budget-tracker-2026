"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { AnalyticsCategoryItem } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";

interface CategoryBreakdownChartProps {
  data: AnalyticsCategoryItem[];
  currency: string;
  hideAmounts: boolean;
}

export function CategoryBreakdownChart({ data, currency, hideAmounts }: CategoryBreakdownChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-warm-300 text-sm">
        No data for this period
      </div>
    );
  }

  const sym = getCurrencySymbol(currency);

  return (
    <div className="space-y-4">
      {/* Donut chart */}
      <div className="flex justify-center">
        <div className="w-[180px] h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="amount"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={85}
                paddingAngle={2}
                strokeWidth={0}
              >
                {data.map((entry) => (
                  <Cell key={entry.id} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0].payload as AnalyticsCategoryItem;
                  return (
                    <div className="bg-white rounded-xl shadow-soft-md border border-cream-200 px-3 py-2">
                      <p className="text-sm font-medium text-warm-600">{item.name}</p>
                      <p className="text-xs text-warm-400">
                        {hideAmounts ? `${sym} ••••••` : formatCurrency(item.amount, currency)} ({item.percentage}%)
                      </p>
                      <p className="text-xs text-warm-300">{item.transactionCount} transactions</p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category list */}
      <div className="space-y-2 max-h-[280px] overflow-y-auto">
        {data.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-1">
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
          </div>
        ))}
      </div>
    </div>
  );
}
