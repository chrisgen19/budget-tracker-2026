"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { MonthlyTrendItem } from "@/types";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { monthKeyRange } from "@/lib/analytics-period";
import { buildTransactionsHref } from "@/lib/transaction-filter-url";
import { ChartTooltipCard, TooltipRow } from "@/components/analytics/chart-tooltip";
import { ChartEmptyState } from "@/components/analytics/chart-empty-state";
import { DrillDownLink, drillDownLabel } from "@/components/analytics/drill-down-link";
import {
  AXIS_TICK,
  AXIS_TICK_MUTED,
  GRID_STROKE,
  INCOME_COLOR,
  EXPENSE_COLOR,
  formatAbbreviated,
} from "@/components/analytics/chart-theme";

interface MonthlyTrendChartProps {
  data: MonthlyTrendItem[];
  currency: string;
  hideAmounts: boolean;
}

const UNSELECTED_OPACITY = 0.35;

/** A month the user picked, and the newest month of the window it was picked in. */
export interface TrendSelection {
  anchorKey: string;
  monthKey: string;
}

/**
 * The month the footer describes: the user's pick, or the newest month of the window.
 *
 * A pick belongs to the window it was made in. The chart stays mounted when the dashboard steps
 * to a month React Query already has cached, so component state alone would carry a July picked
 * under October into November, whose six months still include July, and the footer would offer
 * July while the header says November. Tying the pick to its window's newest month drops it the
 * moment the window moves, however the dashboard got there.
 */
export const resolveSelectedMonth = (
  selection: TrendSelection | null,
  data: MonthlyTrendItem[],
): MonthlyTrendItem => {
  const latest = data[data.length - 1];
  if (!selection || selection.anchorKey !== latest.monthKey) return latest;
  return data.find((m) => m.monthKey === selection.monthKey) ?? latest;
};

const longMonthFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-11" -> "November 2026". Formatted in UTC so the month never shifts with the viewer's zone. */
const longMonthName = (monthKey: string) => {
  const [year, month] = monthKey.split("-").map(Number);
  return longMonthFormat.format(new Date(Date.UTC(year, month - 1, 1)));
};

function LegendChips() {
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="flex items-center gap-1.5 text-xs text-warm-400">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: INCOME_COLOR }} />
        Income
      </span>
      <span className="flex items-center gap-1.5 text-xs text-warm-400">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: EXPENSE_COLOR }} />
        Expenses
      </span>
    </div>
  );
}

interface MonthFooterProps {
  item: MonthlyTrendItem;
  fmt: (value: number) => string;
}

/**
 * The selected month's totals and the way into its transactions. The column selects and
 * this row navigates, the same split the analytics heatmap makes: a bar is too small a
 * target to be a link, and on touch tapping it is the only way to read a month.
 */
function MonthFooter({ item, fmt }: MonthFooterProps) {
  const name = longMonthName(item.monthKey);
  const totals = (
    <span className="text-xs text-warm-500 tabular-nums">
      <span className="text-income">{fmt(item.income)}</span>
      {" in · "}
      <span className="text-expense">{fmt(item.expenses)}</span>
      {" out"}
    </span>
  );

  return (
    <div className="pt-1" aria-live="polite">
      {item.transactionCount > 0 ? (
        <DrillDownLink
          href={buildTransactionsHref(monthKeyRange(item.monthKey))}
          label={drillDownLabel(item.transactionCount, name)}
          className="flex min-h-11 items-center justify-between gap-2 border border-amber/25 bg-amber-50 px-3 text-sm font-medium text-amber-dark"
        >
          <span className="min-w-0">
            <span className="block">{name}</span>
            {totals}
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </DrillDownLink>
      ) : (
        <div className="flex min-h-11 flex-col justify-center px-3 text-sm text-warm-500">
          <span className="font-medium text-warm-600">{name}</span>
          <span className="text-xs text-warm-300">No transactions</span>
        </div>
      )}
    </div>
  );
}

export function MonthlyTrendChart({ data, currency, hideAmounts }: MonthlyTrendChartProps) {
  const [selection, setSelection] = useState<TrendSelection | null>(null);

  if (!data.some((m) => m.income > 0 || m.expenses > 0)) {
    return <ChartEmptyState message="No data yet" hint="Add a transaction to see your monthly trend" />;
  }

  const sym = getCurrencySymbol(currency);
  const fmt = (v: number) => (hideAmounts ? `${sym} ••••••` : formatCurrency(v, currency));
  const selected = resolveSelectedMonth(selection, data);
  const select = (monthKey: string) =>
    setSelection({ anchorKey: data[data.length - 1].monthKey, monthKey });

  const chartData = data.map((item) => ({
    ...item,
    label: item.month.split(" ")[0], // "Nov 2026" -> "Nov"
  }));
  const opacityFor = (key: string) => (key === selected.monthKey ? 1 : UNSELECTED_OPACITY);

  return (
    <div>
      <LegendChips />
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            barGap={2}
            style={{ cursor: "pointer" }}
            onClick={(state) => {
              const index = state?.activeTooltipIndex;
              if (typeof index === "number" && data[index]) select(data[index].monthKey);
            }}
          >
            <CartesianGrid horizontal vertical={false} strokeDasharray="4 4" stroke={GRID_STROKE} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={AXIS_TICK_MUTED}
              tickFormatter={hideAmounts ? () => "" : formatAbbreviated}
              width={hideAmounts ? 8 : 42}
            />
            <Tooltip
              cursor={{ fill: GRID_STROKE, fillOpacity: 0.3 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0]?.payload as MonthlyTrendItem;
                return (
                  <ChartTooltipCard label={item.month}>
                    <TooltipRow label="Income" value={fmt(item.income)} color={INCOME_COLOR} />
                    <TooltipRow label="Expenses" value={fmt(item.expenses)} color={EXPENSE_COLOR} />
                  </ChartTooltipCard>
                );
              }}
            />
            <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28}>
              {chartData.map((m) => (
                <Cell key={m.monthKey} fillOpacity={opacityFor(m.monthKey)} />
              ))}
            </Bar>
            <Bar dataKey="expenses" name="Expenses" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28}>
              {chartData.map((m) => (
                <Cell key={m.monthKey} fillOpacity={opacityFor(m.monthKey)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MonthFooter item={selected} fmt={fmt} />
    </div>
  );
}
