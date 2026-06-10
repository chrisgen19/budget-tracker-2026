"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import type { AnalyticsCategoryItem } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { ChartTooltipCard } from "@/components/analytics/chart-tooltip";
import { ChartEmptyState } from "@/components/analytics/chart-empty-state";

interface CategoryBreakdownChartProps {
  data: AnalyticsCategoryItem[];
  currency: string;
  hideAmounts: boolean;
}

export function CategoryBreakdownChart({ data, currency, hideAmounts }: CategoryBreakdownChartProps) {
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
          <div key={item.id} className="flex items-center gap-3 px-1.5 py-1.5 rounded-lg hover:bg-cream-50 transition-colors">
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
