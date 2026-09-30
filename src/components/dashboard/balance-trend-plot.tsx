"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AMBER_COLOR,
  AXIS_TICK,
  AXIS_TICK_MUTED,
  GRID_STROKE,
  REFERENCE_STROKE,
  formatAbbreviated,
} from "@/components/analytics/chart-theme";
import { ChartTooltipCard, TooltipRow } from "@/components/analytics/chart-tooltip";
import { balanceYAxis, formatSignedAmount, type BalanceChartRow } from "@/lib/balance-trend";
import { maskCurrency } from "@/lib/utils";

export const PREVIOUS_MONTH_COLOR = "#B5A898";

interface BalanceTrendPlotProps {
  rows: BalanceChartRow[];
  compare: boolean;
  /** Short names for the tooltip and ticks, e.g. "Sep" and "Aug". */
  currentName: string;
  previousName: string;
  /** Day of month to mark as today, or null when the selected month is not the current one. */
  todayDay: number | null;
  /** Days in the selected month, for the last X tick. */
  daysInMonth: number;
  hideAmounts: boolean;
  currency: string;
}

/** The chart half of the Balance Trend card: this month, and last month when comparing. */
export function BalanceTrendPlot({
  rows,
  compare,
  currentName,
  previousName,
  todayDay,
  daysInMonth,
  hideAmounts,
  currency,
}: BalanceTrendPlotProps) {
  const values = rows
    .flatMap((row) => [row.current, row.previous])
    .filter((value): value is number => value != null);
  const yAxis = balanceYAxis(values, compare);
  const ticks = [1, 8, 15, 22, daysInMonth];
  const format = (value: number) =>
    compare ? formatSignedAmount(value, currency, hideAmounts) : maskCurrency(value, currency, hideAmounts);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="balanceTrendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMBER_COLOR} stopOpacity={0.22} />
            <stop offset="100%" stopColor={AMBER_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid horizontal vertical={false} strokeDasharray="4 4" stroke={GRID_STROKE} />
        <XAxis
          dataKey="day"
          type="number"
          domain={[1, rows.length]}
          ticks={ticks}
          axisLine={false}
          tickLine={false}
          tick={AXIS_TICK}
          tickFormatter={(day: number) => `${currentName} ${day}`}
        />
        {/* Hide-amounts hides the ticks too: an axis reading 193.4K gives the balance away. */}
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={hideAmounts ? false : AXIS_TICK_MUTED}
          tickFormatter={formatAbbreviated}
          width={hideAmounts ? 8 : 50}
          domain={yAxis.domain}
          ticks={yAxis.ticks}
        />
        {compare && <ReferenceLine y={0} stroke={REFERENCE_STROKE} />}
        {todayDay != null && (
          <ReferenceLine x={todayDay} stroke={REFERENCE_STROKE} strokeDasharray="3 3" />
        )}
        <Tooltip
          cursor={{ stroke: REFERENCE_STROKE }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as BalanceChartRow | undefined;
            if (!active || !row) return null;
            return (
              <ChartTooltipCard label={compare ? "Change since the 1st" : undefined}>
                {row.current != null && (
                  <TooltipRow
                    label={`${currentName} ${row.day}`}
                    value={format(row.current)}
                    color={AMBER_COLOR}
                  />
                )}
                {row.previous != null && (
                  <TooltipRow
                    label={`${previousName} ${row.day}`}
                    value={format(row.previous)}
                    color={PREVIOUS_MONTH_COLOR}
                  />
                )}
              </ChartTooltipCard>
            );
          }}
        />
        {compare && (
          <Line
            type="monotone"
            dataKey="previous"
            stroke={PREVIOUS_MONTH_COLOR}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 3 }}
          />
        )}
        <Area
          type="monotone"
          dataKey="current"
          stroke={AMBER_COLOR}
          strokeWidth={2}
          fill="url(#balanceTrendGradient)"
          activeDot={{ r: 4 }}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
