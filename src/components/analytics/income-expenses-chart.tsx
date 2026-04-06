"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { AnalyticsPeriodItem } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";

/** Abbreviate large numbers for Y-axis */
const formatAbbreviated = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
};

interface IncomeExpensesChartProps {
  data: AnalyticsPeriodItem[];
  currency: string;
  hideAmounts: boolean;
}

export function IncomeExpensesChart({ data, currency, hideAmounts }: IncomeExpensesChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-warm-300 text-sm">
        No data for this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barGap={2}>
        <CartesianGrid
          horizontal
          vertical={false}
          strokeDasharray="4 4"
          stroke="#E8DFD0"
        />
        <XAxis
          dataKey="periodLabel"
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#8B7E6A", fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#B5A898", fontSize: 11 }}
          tickFormatter={formatAbbreviated}
          width={45}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="bg-white rounded-xl shadow-soft-md border border-cream-200 px-4 py-3">
                <p className="text-xs text-warm-400 mb-1.5">{label}</p>
                {payload.map((entry) => (
                  <p key={entry.dataKey as string} className="text-sm font-medium" style={{ color: entry.color }}>
                    {entry.name}:{" "}
                    {hideAmounts
                      ? `${getCurrencySymbol(currency)} ••••••`
                      : formatCurrency(entry.value as number, currency)}
                  </p>
                ))}
              </div>
            );
          }}
        />
        <Bar
          dataKey="income"
          name="Income"
          fill="#2D8B5A"
          radius={[4, 4, 0, 0]}
          maxBarSize={32}
        />
        <Bar
          dataKey="expenses"
          name="Expenses"
          fill="#C44B3F"
          radius={[4, 4, 0, 0]}
          maxBarSize={32}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
