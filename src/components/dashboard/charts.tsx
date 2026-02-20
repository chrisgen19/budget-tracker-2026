"use client";

import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import type { BalanceTrendItem, CategoryBreakdownItem, MonthlyTrendItem } from "@/types";
import { formatCurrency, cn } from "@/lib/utils";

/** Abbreviate large numbers for Y-axis: 193400 → "193.4K" */
const formatAbbreviated = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
};

/** Format date key for X-axis ticks: "2026-02-14" → "2/14" */
const formatDateTick = (dateStr: string) => {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
};

interface TrendChartProps {
  data: MonthlyTrendItem[];
}

export function TrendChart({ data }: TrendChartProps) {
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
  if (data.length === 0) return null;

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

interface BalanceTrendChartProps {
  data: BalanceTrendItem[];
  hideAmounts: boolean;
}

export function BalanceTrendChart({ data, hideAmounts }: BalanceTrendChartProps) {
  if (data.length === 0) return null;

  const currentBalance = data[data.length - 1].balance;
  const startBalance = data[0].balance;
  const pctChange =
    startBalance !== 0
      ? ((currentBalance - startBalance) / Math.abs(startBalance)) * 100
      : currentBalance > 0
        ? 100
        : currentBalance < 0
          ? -100
          : 0;

  return (
    <div>
      {/* Header */}
      <h2 className="font-serif text-lg text-warm-700">Balance Trend</h2>
      <p className="text-xs text-warm-300 mb-4">
        Do I have more money than before?
      </p>

      {/* Key Metrics Row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">
            Today
          </p>
          {hideAmounts ? (
            <span className="font-serif text-xl text-warm-700">₱ ••••••</span>
          ) : (
            <span className="font-serif text-xl text-warm-700">
              {formatCurrency(currentBalance)}
            </span>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase">
            Last 30 Days
          </p>
          <span
            className={cn(
              "inline-block px-2.5 py-0.5 rounded-full text-sm font-medium",
              pctChange > 0 && "bg-income-light text-income",
              pctChange < 0 && "bg-expense-light text-expense",
              pctChange === 0 && "bg-cream-200 text-warm-400"
            )}
          >
            {hideAmounts
              ? "••%"
              : `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`}
          </span>
        </div>
      </div>

      {/* Area Chart */}
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            horizontal
            vertical={false}
            strokeDasharray="4 4"
            stroke="#E8DFD0"
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#8B7E6A", fontSize: 11 }}
            tickFormatter={formatDateTick}
            interval="preserveStartEnd"
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#B5A898", fontSize: 11 }}
            tickFormatter={formatAbbreviated}
            width={50}
            domain={["dataMin", "dataMax"]}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const balance = payload[0].value as number;
              return (
                <div className="bg-white rounded-xl shadow-soft-md border border-cream-200 px-3 py-2">
                  <p className="text-xs text-warm-400 mb-1">
                    {formatDateTick(label as string)}
                  </p>
                  <p className="text-sm font-medium text-warm-700">
                    {hideAmounts ? "₱ ••••••" : formatCurrency(balance)}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#balanceGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
