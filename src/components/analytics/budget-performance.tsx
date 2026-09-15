"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CalendarClock, Pencil, PiggyBank, TrendingUp, WalletCards } from "lucide-react";
import { CategoryIcon } from "@/components/ui/icon-map";
import { BudgetPlanEditor } from "@/components/analytics/budget-plan-editor";
import { useBudgetPerformance } from "@/hooks/use-budget-plan";
import { useCategoriesQuery } from "@/hooks/use-categories";
import { filterSearchParams } from "@/lib/transaction-period-url";
import { cn, maskCurrency } from "@/lib/utils";
import type { BudgetPerformanceAllocation } from "@/types";

interface BudgetPerformanceProps {
  month: string;
  timezoneOffset: number;
  currency: string;
  hideAmounts: boolean;
  returnTo: string;
}

const fullMonthRange = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-warm-400">{label}</p>
      <p className="mt-1 font-serif text-xl text-warm-700">{value}</p>
      <p className="mt-1 text-xs text-warm-400">{detail}</p>
    </div>
  );
}

function AllocationRow({ row, month, effectiveTo, currency, hideAmounts, returnTo }: {
  row: BudgetPerformanceAllocation;
  month: string;
  effectiveTo: string | null;
  currency: string;
  hideAmounts: boolean;
  returnTo: string;
}) {
  const range = fullMonthRange(month);
  const used = row.available > 0 ? Math.max(0, Math.round((row.actual / row.available) * 100)) : 0;
  const remainingFavorable = row.type === "INCOME" ? row.remaining <= 0 : row.remaining >= 0;
  const varianceFavorable = row.varianceAmount >= 0;
  const query = filterSearchParams({
    period: "monthly",
    from: range.from,
    to: effectiveTo ?? range.to,
    type: row.type,
    categoryId: row.categoryId,
    ret: returnTo,
  });
  return (
    <div className="py-4 border-b border-cream-100 last:border-0">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${row.categoryColor}18`, color: row.categoryColor }}>
          <CategoryIcon name={row.categoryIcon} className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm text-warm-700">{row.categoryName}</p>
            <span className="rounded-full bg-cream-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-warm-400">{row.kind.toLowerCase()}</span>
            {row.forecastToExceed && <span className="rounded-full bg-expense-light px-2 py-0.5 text-[10px] font-semibold text-expense">Forecast to exceed</span>}
          </div>
          <p className="mt-1 text-xs text-warm-400">{row.projectionBasis}</p>
        </div>
        {effectiveTo && row.actual > 0 ? (
          <Link href={`/transactions?${query}`} className="min-h-11 flex items-center text-right text-sm font-medium text-amber-700 hover:text-amber-800">
            {maskCurrency(row.actual, currency, hideAmounts)}
          </Link>
        ) : (
          <span className="min-h-11 flex items-center text-right text-sm font-medium text-warm-500">{maskCurrency(row.actual, currency, hideAmounts)}</span>
        )}
      </div>
      <div className="mt-3 ml-12 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <span className="text-warm-400">Planned <strong className="block text-warm-600">{maskCurrency(row.planned, currency, hideAmounts)}</strong></span>
        <span className="text-warm-400">Remaining <strong className={cn("block", remainingFavorable ? "text-income" : "text-expense")}>{maskCurrency(row.remaining, currency, hideAmounts)}</strong></span>
        <span className="text-warm-400">Variance <strong className={cn("block", varianceFavorable ? "text-income" : "text-expense")}>{maskCurrency(row.varianceAmount, currency, hideAmounts)}{row.variancePct === null ? "" : ` (${Math.round(row.variancePct * 100)}%)`}</strong></span>
        <span className="text-warm-400">Projected <strong className="block text-warm-600">{row.projectedActual === null ? "—" : maskCurrency(row.projectedActual, currency, hideAmounts)}</strong></span>
        <span className="text-warm-400">Rollover <strong className="block text-warm-600">{row.rolloverEnabled ? `In ${maskCurrency(row.rolloverCarryIn, currency, hideAmounts)} · Out ${maskCurrency(row.rolloverCarryOut ?? 0, currency, hideAmounts)}` : "Off"}</strong></span>
      </div>
      {row.type === "EXPENSE" && (
        <div className="mt-3 ml-12 h-2 rounded-full bg-cream-100 overflow-hidden" aria-label={`${row.categoryName}: ${used}% used`}>
          <div className={cn("h-full rounded-full", used > 100 ? "bg-expense" : used >= 80 ? "bg-amber-500" : "bg-income")} style={{ width: `${Math.min(used, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function BudgetPerformance(props: BudgetPerformanceProps) {
  const { month, timezoneOffset, currency, hideAmounts, returnTo } = props;
  const [editing, setEditing] = useState(false);
  const budget = useBudgetPerformance(month, timezoneOffset);
  const categories = useCategoriesQuery();

  if (budget.isLoading || categories.isLoading) return <div className="card h-80 animate-shimmer" />;
  if (budget.isError || categories.isError || !budget.data) {
    return <div className="card p-8 text-center"><AlertTriangle className="mx-auto w-6 h-6 text-expense" /><p className="mt-3 text-warm-600">Failed to load the budget plan.</p><button onClick={() => budget.refetch()} className="mt-3 min-h-11 px-4 text-sm font-medium text-amber-700">Try again</button></div>;
  }

  const data = budget.data;
  const fmt = (value: number) => maskCurrency(value, currency, hideAmounts);
  const range = fullMonthRange(month);
  const allExpensesQuery = filterSearchParams({
    period: "monthly",
    from: range.from,
    to: data.progress.effectiveTo ?? range.to,
    type: "EXPENSE",
    ret: returnTo,
  });
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><WalletCards className="w-5 h-5 text-amber-600" /><h2 className="font-serif text-lg text-warm-700">Budget Performance</h2></div>
            <p className="mt-1 text-sm text-warm-400">{data.progress.daysElapsed} of {data.progress.daysInMonth} days elapsed · {data.progress.percentElapsed}%</p>
            {data.plan && <p className="mt-1 text-xs text-warm-300">Revision {data.plan.revision} of {data.plan.revisionCount} · saved {new Date(data.plan.createdAt).toLocaleString()}</p>}
          </div>
          <button onClick={() => setEditing(true)} className="min-h-11 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-700">
            <Pencil className="w-4 h-4" /> {data.plan ? "Edit plan" : "Create plan"}
          </button>
        </div>
        {data.plan && data.plan.history.length > 1 && (
          <details className="mt-3 border-t border-cream-100 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-warm-400">Revision history</summary>
            <ol className="mt-2 space-y-1 text-xs text-warm-400">
              {data.plan.history.map((revision) => (
                <li key={revision.id}>
                  Revision {revision.revision} · {new Date(revision.createdAt).toLocaleString()}
                  {revision.id === data.plan?.id ? " · used by this report" : ""}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>

      {!data.plan ? (
        <div className="card p-10 text-center"><PiggyBank className="mx-auto w-10 h-10 text-amber-500" /><h3 className="mt-3 font-serif text-lg text-warm-700">Plan this month intentionally</h3><p className="mx-auto mt-2 max-w-md text-sm text-warm-400">Set planned income and category allocations to unlock remaining amounts, pace forecasts, rollover, and safe-to-spend guidance.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label="Available budget" value={fmt(data.totals.availableExpenses)} detail={`Planned ${fmt(data.totals.plannedExpenses)}`} />
            <SummaryCard label="Actual expenses" value={fmt(data.totals.actualExpenses)} detail={`${fmt(data.totals.unbudgetedExpenses)} unbudgeted`} />
            <SummaryCard label="Remaining" value={fmt(data.totals.remainingExpenses)} detail="Available minus all expenses" />
            <SummaryCard label="Projected" value={data.totals.projectedExpenses === null ? "—" : fmt(data.totals.projectedExpenses)} detail={data.forecastStatus === "available" ? "Flexible pace + logged fixed/savings" : "Needs activity in this month"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-5"><div className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-amber-600" /><h3 className="font-serif text-lg text-warm-700">Safe to spend</h3></div><p className="mt-3 font-serif text-2xl text-warm-700">{data.safeToSpend.perDay === null ? "—" : `${fmt(data.safeToSpend.perDay)} / day`}</p><p className="mt-1 text-sm text-warm-400">{data.safeToSpend.perWeek === null ? "No remaining-day pace" : `${fmt(data.safeToSpend.perWeek)} per week`}</p>{data.safeToSpend.nextIncomeDate && <p className="mt-3 text-sm text-warm-500">Until next scheduled income ({data.safeToSpend.nextIncomeDate}): <strong>{fmt(data.safeToSpend.untilNextIncome ?? 0)}</strong></p>}<p className="mt-3 text-xs text-warm-300">{data.safeToSpend.basis}</p></div>
            <div className="card p-5"><div className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-amber-600" /><h3 className="font-serif text-lg text-warm-700">Income plan</h3></div><p className="mt-3 font-serif text-2xl text-warm-700">{fmt(data.totals.actualIncome)} <span className="font-sans text-sm text-warm-400">actual</span></p><p className="mt-1 text-sm text-warm-400">{fmt(data.totals.plannedIncome)} planned</p></div>
          </div>

          <div className="card p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-serif text-lg text-warm-700">Category plan</h3><p className="mt-1 text-sm text-warm-400">Select an actual amount to inspect the transactions behind it.</p></div>{data.progress.effectiveTo && <Link href={`/transactions?${allExpensesQuery}`} className="min-h-11 inline-flex items-center text-sm font-medium text-amber-700 hover:text-amber-800">View all actual expenses</Link>}</div><div className="mt-3">{data.allocations.map((row) => <AllocationRow key={row.categoryId} row={row} month={month} effectiveTo={data.progress.effectiveTo} currency={currency} hideAmounts={hideAmounts} returnTo={returnTo} />)}</div></div>
          <details className="card p-5"><summary className="cursor-pointer text-sm font-medium text-warm-600">How actuals and special transactions are treated</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-warm-400">{data.treatmentNotes.map((note) => <li key={note}>{note}</li>)}</ul></details>
        </>
      )}

      <BudgetPlanEditor open={editing} onClose={() => setEditing(false)} month={month} timezoneOffset={timezoneOffset} categories={categories.data ?? []} performance={data} hideAmounts={hideAmounts} />
    </div>
  );
}
