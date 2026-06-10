"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { Layers } from "lucide-react";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { ChartTooltipCard, TooltipRow } from "@/components/analytics/chart-tooltip";
import { ChartEmptyState } from "@/components/analytics/chart-empty-state";
import { AXIS_TICK, AXIS_TICK_MUTED, GRID_STROKE, formatAbbreviated } from "@/components/analytics/chart-theme";
import type { AnalyticsCategoryTrends } from "@/types";

interface CategoryTrendsChartProps {
  data: AnalyticsCategoryTrends;
  currency: string;
  hideAmounts: boolean;
}

export function CategoryTrendsChart({ data, currency, hideAmounts }: CategoryTrendsChartProps) {
  const chartData = useMemo(
    () => data.points.map((p) => ({ periodLabel: p.periodLabel, ...p.values })),
    [data.points]
  );

  if (data.series.length === 0) {
    return <ChartEmptyState icon={Layers} message="No expenses this period" hint="Category trends appear once you log expenses" />;
  }

  const sym = getCurrencySymbol(currency);
  const fmt = (v: number) => (hideAmounts ? `${sym} ••••••` : formatCurrency(v, currency));
  const colorById = new Map(data.series.map((s) => [s.id, s.color]));
  const nameById = new Map(data.series.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {data.series.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-xs text-warm-400">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="h-[220px] sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barGap={2}>
            <CartesianGrid horizontal vertical={false} strokeDasharray="4 4" stroke={GRID_STROKE} />
            <XAxis
              dataKey="periodLabel"
              axisLine={false}
              tickLine={false}
              tick={AXIS_TICK}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={AXIS_TICK_MUTED}
              tickFormatter={formatAbbreviated}
              width={42}
            />
            <Tooltip
              cursor={{ fill: "rgba(232, 223, 208, 0.3)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const rows = payload
                  .filter((entry) => (entry.value as number) > 0)
                  .sort((a, b) => (b.value as number) - (a.value as number));
                if (rows.length === 0) return null;
                return (
                  <ChartTooltipCard label={label as string}>
                    {rows.map((entry) => (
                      <TooltipRow
                        key={entry.dataKey as string}
                        label={nameById.get(entry.dataKey as string) ?? ""}
                        value={fmt(entry.value as number)}
                        color={colorById.get(entry.dataKey as string)}
                      />
                    ))}
                  </ChartTooltipCard>
                );
              }}
            />
            {data.series.map((s) => (
              <Bar
                key={s.id}
                dataKey={s.id}
                stackId="expenses"
                fill={s.color}
                radius={[2, 2, 0, 0]}
                maxBarSize={32}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
