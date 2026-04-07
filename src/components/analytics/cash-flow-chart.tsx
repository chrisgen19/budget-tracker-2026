"use client";

import { useId } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { AnalyticsCashFlowItem } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";

/** Abbreviate large numbers for Y-axis */
const formatAbbreviated = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
};

interface CashFlowChartProps {
  data: AnalyticsCashFlowItem[];
  currency: string;
  hideAmounts: boolean;
}

export function CashFlowChart({ data, currency, hideAmounts }: CashFlowChartProps) {
  const uid = useId();
  const posId = `cfPos${uid}`;
  const negId = `cfNeg${uid}`;
  const cumId = `cfCum${uid}`;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-warm-300 text-sm">
        No data for this period
      </div>
    );
  }

  // Split net into positive/negative for dual-color fill
  const chartData = data.map((item) => ({
    ...item,
    netPositive: item.net >= 0 ? item.net : 0,
    netNegative: item.net < 0 ? item.net : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id={posId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2D8B5A" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#2D8B5A" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={negId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#C44B3F" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#C44B3F" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={cumId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
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
        <ReferenceLine y={0} stroke="#D4C9B8" strokeDasharray="3 3" />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const item = payload[0]?.payload as AnalyticsCashFlowItem;
            const sym = getCurrencySymbol(currency);
            return (
              <div className="bg-white rounded-xl shadow-soft-md border border-cream-200 px-4 py-3">
                <p className="text-xs text-warm-400 mb-1.5">{label}</p>
                <p className="text-sm font-medium text-income">
                  Income: {hideAmounts ? `${sym} ••••••` : formatCurrency(item.income, currency)}
                </p>
                <p className="text-sm font-medium text-expense">
                  Expenses: {hideAmounts ? `${sym} ••••••` : formatCurrency(item.expenses, currency)}
                </p>
                <div className="border-t border-cream-100 mt-1.5 pt-1.5">
                  <p className={`text-sm font-semibold ${item.net >= 0 ? "text-income" : "text-expense"}`}>
                    Net: {hideAmounts ? `${sym} ••••••` : formatCurrency(item.net, currency)}
                  </p>
                  <p className="text-xs text-warm-400">
                    Cumulative: {hideAmounts ? `${sym} ••••••` : formatCurrency(item.cumulativeNet, currency)}
                  </p>
                </div>
              </div>
            );
          }}
        />
        {/* Net cash flow bars visualized as area */}
        <Area
          type="monotone"
          dataKey="netPositive"
          stroke="#2D8B5A"
          strokeWidth={2}
          fill={`url(#${posId})`}
        />
        <Area
          type="monotone"
          dataKey="netNegative"
          stroke="#C44B3F"
          strokeWidth={2}
          fill={`url(#${negId})`}
        />
        {/* Cumulative net line */}
        <Area
          type="monotone"
          dataKey="cumulativeNet"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          fill={`url(#${cumId})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
