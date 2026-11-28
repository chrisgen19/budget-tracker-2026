"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { MonthlyTrendItem } from "@/types";
import { formatCurrency } from "@/lib/utils";

/** Abbreviate large numbers for Y-axis: 193400 → "193.4K" */
const formatAbbreviated = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
};

interface TrendChartProps {
  data: MonthlyTrendItem[];
  currency?: string;
}

export function TrendChart({ data, currency = "PHP" }: TrendChartProps) {
  if (data.length === 0) return null;

  // Shorten month labels for display
  const chartData = data.map((item) => ({
    ...item,
    label: item.month.split(" ")[0], // "Jan 2026" -> "Jan"
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} barGap={2}>
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#8B7E6A", fontSize: 12 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#B5A898", fontSize: 11 }}
          tickFormatter={formatAbbreviated}
          width={40}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="bg-white rounded-xl shadow-soft-md border border-cream-200 px-4 py-3">
                <p className="text-xs text-warm-400 mb-1.5">{label}</p>
                {payload.map((entry) => (
                  <p key={entry.dataKey as string} className="text-sm font-medium" style={{ color: entry.color }}>
                    {entry.name}: {formatCurrency(entry.value as number, currency)}
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
          maxBarSize={28}
        />
        <Bar
          dataKey="expenses"
          name="Expenses"
          fill="#C44B3F"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
