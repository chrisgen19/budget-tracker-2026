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
import { ChartTooltipCard, TooltipRow } from "@/components/analytics/chart-tooltip";
import { ChartEmptyState } from "@/components/analytics/chart-empty-state";
import {
  AXIS_TICK,
  AXIS_TICK_MUTED,
  GRID_STROKE,
  REFERENCE_STROKE,
  INCOME_COLOR,
  EXPENSE_COLOR,
  AMBER_COLOR,
  formatAbbreviated,
} from "@/components/analytics/chart-theme";

interface CashFlowChartProps {
  data: AnalyticsCashFlowItem[];
  currency: string;
  hideAmounts: boolean;
}

function LegendChips() {
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="flex items-center gap-1.5 text-xs text-warm-400">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: INCOME_COLOR }} />
        Net flow
      </span>
      <span className="flex items-center gap-1.5 text-xs text-warm-400">
        <svg width="16" height="4" className="shrink-0">
          <line x1="0" y1="2" x2="16" y2="2" stroke={AMBER_COLOR} strokeWidth="2" strokeDasharray="4 2" />
        </svg>
        Cumulative
      </span>
    </div>
  );
}

export function CashFlowChart({ data, currency, hideAmounts }: CashFlowChartProps) {
  const uid = useId();
  const posId = `cfPos${uid}`;
  const negId = `cfNeg${uid}`;
  const cumId = `cfCum${uid}`;

  if (data.length === 0) {
    return <ChartEmptyState message="No data for this period" hint="Try a wider date range or add transactions" />;
  }

  const sym = getCurrencySymbol(currency);
  const fmt = (v: number) => (hideAmounts ? `${sym} ••••••` : formatCurrency(v, currency));

  // Split net into positive/negative for dual-color fill
  const chartData = data.map((item) => ({
    ...item,
    netPositive: item.net >= 0 ? item.net : 0,
    netNegative: item.net < 0 ? item.net : 0,
  }));

  return (
    <div>
      <LegendChips />
      <div className="h-[220px] sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={posId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={INCOME_COLOR} stopOpacity={0.2} />
                <stop offset="100%" stopColor={INCOME_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={negId} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={EXPENSE_COLOR} stopOpacity={0.2} />
                <stop offset="100%" stopColor={EXPENSE_COLOR} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={cumId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={AMBER_COLOR} stopOpacity={0.12} />
                <stop offset="100%" stopColor={AMBER_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
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
            <ReferenceLine y={0} stroke={REFERENCE_STROKE} strokeDasharray="3 3" />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0]?.payload as AnalyticsCashFlowItem;
                return (
                  <ChartTooltipCard label={label as string}>
                    <TooltipRow label="Income" value={fmt(item.income)} color={INCOME_COLOR} />
                    <TooltipRow label="Expenses" value={fmt(item.expenses)} color={EXPENSE_COLOR} />
                    <div className="border-t border-cream-100 mt-1.5 pt-1.5">
                      <TooltipRow
                        label="Net"
                        value={fmt(item.net)}
                        className={item.net >= 0 ? "text-income" : "text-expense"}
                      />
                      <TooltipRow label="Cumulative" value={fmt(item.cumulativeNet)} color={AMBER_COLOR} />
                    </div>
                  </ChartTooltipCard>
                );
              }}
            />
            {/* Net cash flow visualized as area */}
            <Area type="monotone" dataKey="netPositive" stroke={INCOME_COLOR} strokeWidth={2} fill={`url(#${posId})`} />
            <Area type="monotone" dataKey="netNegative" stroke={EXPENSE_COLOR} strokeWidth={2} fill={`url(#${negId})`} />
            {/* Cumulative net line */}
            <Area
              type="monotone"
              dataKey="cumulativeNet"
              stroke={AMBER_COLOR}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              fill={`url(#${cumId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
