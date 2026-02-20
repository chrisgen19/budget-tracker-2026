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
import { formatCurrency, getCurrencySymbol, cn } from "@/lib/utils";

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

interface SpendingChartProps {
  data: CategoryBreakdownItem[];
  currency?: string;
}

export function SpendingChart({ data, currency = "PHP" }: SpendingChartProps) {
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
                      {formatCurrency(item.amount, currency)} ({item.percentage}%)
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
            <div className="flex-1 min-w-0">
              <span className="text-xs text-warm-500 truncate block">
                {item.name}
              </span>
              <span className="text-[10px] text-warm-400 tabular-nums">
                {formatCurrency(item.amount, currency)}
              </span>
            </div>
            <span className="text-xs font-medium text-warm-600 tabular-nums shrink-0">
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
  currency?: string;
}

export function BalanceTrendChart({ data, hideAmounts, currency = "PHP" }: BalanceTrendChartProps) {
  if (data.length === 0) return null;

  // Split data into actual (up to today) and projected (today onward)
  const todayKey = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const chartData = data.map((item) => {
    const isActual = item.date <= todayKey;
    const isToday = item.date === todayKey;
    return {
      date: item.date,
      // Actual line: value up to and including today
      balance: isActual ? item.balance : undefined,
      // Projected line: value from today onward (overlaps on today to connect)
      projected: isActual && !isToday ? undefined : item.balance,
    };
  });

  // Use last actual data point for metrics (not projected future)
  const lastActualIdx = data.findIndex((item) => item.date > todayKey) - 1;
  const actualEndIdx = lastActualIdx >= 0 ? lastActualIdx : data.length - 1;
  const currentBalance = data[actualEndIdx].balance;
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
            <span className="font-serif text-xl text-warm-700">{getCurrencySymbol(currency)} ••••••</span>
          ) : (
            <span className="font-serif text-xl text-warm-700">
              {formatCurrency(currentBalance, currency)}
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
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="projectedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.08} />
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
              // Pick the first non-null value from either series
              const value = (payload.find((p) => p.value != null)?.value ?? 0) as number;
              const isFuture = (label as string) > todayKey;
              return (
                <div className="bg-white rounded-xl shadow-soft-md border border-cream-200 px-3 py-2">
                  <p className="text-xs text-warm-400 mb-1">
                    {formatDateTick(label as string)}
                    {isFuture && " (projected)"}
                  </p>
                  <p className="text-sm font-medium text-warm-700">
                    {hideAmounts ? `${getCurrencySymbol(currency)} ••••••` : formatCurrency(value, currency)}
                  </p>
                </div>
              );
            }}
          />
          {/* Actual balance line (solid) */}
          <Area
            type="monotone"
            dataKey="balance"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#balanceGradient)"
            connectNulls={false}
          />
          {/* Projected balance line (dashed) */}
          <Area
            type="monotone"
            dataKey="projected"
            stroke="#3b82f6"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            strokeOpacity={0.5}
            fill="url(#projectedGradient)"
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
