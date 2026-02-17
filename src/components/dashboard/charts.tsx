"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import type { CategoryBreakdownItem, MonthlyTrendItem } from "@/types";
import { formatCurrency } from "@/lib/utils";

interface TrendChartProps {
  data: MonthlyTrendItem[];
}

export function TrendChart({ data }: TrendChartProps) {
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
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
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
                    {entry.name}: {formatCurrency(entry.value as number)}
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

interface SpendingChartProps {
  data: CategoryBreakdownItem[];
}

export function SpendingChart({ data }: SpendingChartProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-[160px] h-[160px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={75}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload as CategoryBreakdownItem;
                return (
                  <div className="bg-white rounded-xl shadow-soft-md border border-cream-200 px-3 py-2">
                    <p className="text-sm font-medium text-warm-600">{item.name}</p>
                    <p className="text-xs text-warm-400">
                      {formatCurrency(item.amount)} ({item.percentage}%)
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2 min-w-0">
        {data.slice(0, 5).map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-xs text-warm-500 truncate flex-1">
              {item.name}
            </span>
            <span className="text-xs font-medium text-warm-600 tabular-nums">
              {item.percentage}%
            </span>
          </div>
        ))}
        {data.length > 5 && (
          <p className="text-xs text-warm-300 pl-4">
            +{data.length - 5} more
          </p>
        )}
      </div>
    </div>
  );
}
