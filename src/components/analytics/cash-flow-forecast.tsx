"use client";

import { useState } from "react";
import { AlertTriangle, CalendarDays, Pencil, TrendingDown, Wallet } from "lucide-react";
import { useCashFlowForecast, useSaveForecastOpeningBalance } from "@/hooks/use-cash-flow-forecast";
import { maskCurrency } from "@/lib/utils";

export function CashFlowForecast({ timezoneOffset, currency, hideAmounts }: { timezoneOffset: number; currency: string; hideAmounts: boolean }) {
  const [horizon, setHorizon] = useState(30);
  const [editing, setEditing] = useState(false);
  const forecast = useCashFlowForecast(horizon, timezoneOffset);
  const data = forecast.data;
  const fmt = (value: number) => maskCurrency(value, currency, hideAmounts);
  if (forecast.isLoading) return <div className="card h-80 animate-shimmer" />;
  if (forecast.isError || !data) return <div className="card p-8 text-center"><AlertTriangle className="mx-auto h-6 w-6 text-expense" /><p className="mt-3 text-warm-600">Could not load the cash-flow forecast.</p><button onClick={() => forecast.refetch()} className="mt-3 min-h-11 px-4 text-sm font-medium text-amber-700">Try again</button></div>;
  return <div className="space-y-4">
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-amber-600" /><h2 className="font-serif text-lg text-warm-700">Cash-flow forecast</h2></div><p className="mt-1 max-w-2xl text-sm text-warm-400">A directional projection of your tracked balance, not a reconciled bank balance.</p></div><div className="flex rounded-lg bg-cream-100 p-1">{[30, 60, 90].map((days) => <button key={days} onClick={() => setHorizon(days)} className={`min-h-11 rounded-md px-3 text-sm font-medium ${horizon === days ? "bg-white text-warm-700 shadow-sm" : "text-warm-400"}`}>{days}d</button>)}</div></div>
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-warm-600">Forecasts include future-dated transactions, active scheduled income and bills, plus daily flexible and savings budget pace. They cannot model transfers, unplanned spending, or real account balances.</div>
    </div>
    {!data.configured ? <OpeningBalanceForm initialDate={data.today} maxDate={data.today} onDone={() => setEditing(false)} /> : <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Tracked balance today" value={fmt(data.trackedBalanceToday!)} detail={`From ${data.openingBalanceDate}`} /><Metric label="Lowest projected balance" value={data.lowestBalance ? fmt(data.lowestBalance.balance) : "—"} detail={data.lowestBalance ? data.lowestBalance.date : "No projection days"} /><Metric label="Cash crunches" value={String(data.cashCrunches?.length ?? 0)} detail={data.cashCrunches?.[0] ? `First: ${data.cashCrunches[0].date}` : "None projected"} /></div>
      {(data.cashCrunches?.length ?? 0) > 0 && <div className="card border border-expense-light p-4"><div className="flex gap-3"><TrendingDown className="mt-0.5 h-5 w-5 shrink-0 text-expense" /><div><p className="font-medium text-expense">Projected cash crunch</p><p className="mt-1 text-sm text-warm-500">The tracked balance first falls below zero on {data.cashCrunches![0].date} ({fmt(data.cashCrunches![0].balance)}). Review the scheduled events and your opening balance before acting.</p></div></div></div>}
      <div className="card overflow-hidden"><div className="flex items-center justify-between border-b border-cream-100 p-4"><div><h3 className="font-serif text-base text-warm-700">Daily projection</h3><p className="text-xs text-warm-400">Amounts marked ~ include an estimate.</p></div><button onClick={() => setEditing(true)} className="min-h-11 inline-flex items-center gap-2 px-3 text-sm font-medium text-amber-700"><Pencil className="h-4 w-4" />Opening balance</button></div><div className="max-h-[32rem] overflow-auto">{data.daily?.map((entry) => <div key={entry.date} className="grid grid-cols-[6rem_1fr_auto] gap-3 border-b border-cream-100 px-4 py-3 text-sm last:border-0"><div className="text-warm-500">{entry.date}</div><div className="min-w-0 text-xs text-warm-400">{entry.events.length ? entry.events.map((event, index) => <span key={`${event.kind}-${index}`} className="mr-2 inline-block">{event.estimated ? "~" : ""}{event.description}</span>) : "No planned activity"}</div><strong className={entry.projectedBalance < 0 ? "text-expense" : "text-warm-700"}>{fmt(entry.projectedBalance)}</strong></div>)}</div></div>
      <details className="card p-4 text-sm text-warm-500"><summary className="cursor-pointer font-medium text-warm-700">Assumptions and uncertainty</summary><ul className="mt-3 list-disc space-y-1 pl-5">{data.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></details>
      {editing && <OpeningBalanceForm initialDate={data.openingBalanceDate!} maxDate={data.today} initialBalance={data.openingBalance} onDone={() => setEditing(false)} />}
    </>}
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="card p-4"><p className="text-xs font-medium uppercase tracking-wide text-warm-400">{label}</p><p className="mt-1 font-serif text-xl text-warm-700">{value}</p><p className="mt-1 text-xs text-warm-400">{detail}</p></div>; }

function OpeningBalanceForm({ initialDate, maxDate, initialBalance = 0, onDone }: { initialDate: string; maxDate: string; initialBalance?: number; onDone: () => void }) {
  const [balance, setBalance] = useState(String(initialBalance)); const [date, setDate] = useState(initialDate); const save = useSaveForecastOpeningBalance();
  return <div className="card p-5"><div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-amber-600" /><h3 className="font-serif text-lg text-warm-700">Set opening tracked balance</h3></div><p className="mt-1 text-sm text-warm-400">Enter the balance at the start of this date. Logged activity after it is applied to calculate today’s tracked balance.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm text-warm-600">Balance<input aria-label="Opening tracked balance" value={balance} onChange={(event) => setBalance(event.target.value)} type="number" step="0.01" className="mt-1 min-h-11 w-full rounded-lg border border-cream-200 bg-white px-3" /></label><label className="text-sm text-warm-600">As of date<input aria-label="Opening balance date" value={date} onChange={(event) => setDate(event.target.value)} type="date" max={maxDate} className="mt-1 min-h-11 w-full rounded-lg border border-cream-200 bg-white px-3" /></label></div>{save.isError && <p className="mt-2 text-sm text-expense">Could not save this balance. Please try again.</p>}<div className="mt-4 flex gap-2"><button disabled={save.isPending || !date || !Number.isFinite(Number(balance))} onClick={() => save.mutate({ openingBalance: Number(balance), openingBalanceDate: date }, { onSuccess: onDone })} className="min-h-11 rounded-lg bg-amber-600 px-4 text-sm font-medium text-white disabled:opacity-50">{save.isPending ? "Saving…" : "Save forecast baseline"}</button></div></div>;
}
