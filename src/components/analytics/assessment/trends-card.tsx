"use client";

import { TrendingUp, Repeat, ArrowUpRight, ArrowDownRight, Sparkle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Section, Bar, Chip, AllClear, type Money } from "./section";
import type { AssessmentRecurringFacts, AssessmentTrendFacts } from "@/types";

const DIRECTION = {
  up: { icon: ArrowUpRight, tone: "text-expense" },
  down: { icon: ArrowDownRight, tone: "text-income" },
  new: { icon: Sparkle, tone: "text-amber-dark" },
} as const;

/**
 * Where each category moved against the months before it.
 *
 * Ranked by how much money moved, not by percentage. Zero-filling makes an
 * intermittent category read -100% in any month it is skipped, and on a small
 * base that would crowd out the movements that actually matter.
 */
export function TrendsCard({ trends, fmt }: { trends: AssessmentTrendFacts; fmt: Money }) {
  const movements = trends.movements.slice(0, 8);
  const priorCount = Math.max(0, trends.baselineMonths.length - 1);
  const max = Math.max(1, ...movements.map((m) => Math.abs(m.change)));

  return (
    <Section
      icon={TrendingUp}
      title="Category trends"
      subtitle={
        trends.comparedMonthLabel
          ? `${trends.comparedMonthLabel} against the ${priorCount} trustworthy month${priorCount === 1 ? "" : "s"} before it.`
          : "Not enough complete months to compare yet."
      }
      aside={
        trends.avgMonthlyBurn !== null ? (
          <span className="text-xs text-warm-400">{fmt(trends.avgMonthlyBurn)}/mo typical</span>
        ) : undefined
      }
    >
      {movements.length === 0 ? (
        <AllClear>No complete months to compare against yet — trends need at least two.</AllClear>
      ) : (
        <ul className="space-y-2.5">
          {movements.map((m) => {
            const dir = DIRECTION[m.direction];
            const Icon = dir.icon;
            return (
              <li key={m.category}>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <p className="text-sm text-warm-700 truncate">{m.category}</p>
                  <span className={cn("text-xs shrink-0 inline-flex items-center gap-1", dir.tone)}>
                    <Icon className="w-3 h-3" />
                    {m.direction === "new" ? "new" : `${m.changePct !== null && m.changePct > 0 ? "+" : ""}${m.changePct}%`}
                  </span>
                </div>
                <Bar value={m.change} max={max} tone={m.direction === "down" ? "down" : "up"} />
                <p className="text-[11px] text-warm-400 mt-1">
                  {fmt(m.current)} this month · usually {fmt(m.priorAvg)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {trends.baselineSavingsRatePct !== null && (
        <p className="text-xs text-warm-400 mt-4 pt-3 border-t border-cream-200/70">
          Across the trustworthy months you kept {trends.baselineSavingsRatePct}% of what came in.
        </p>
      )}
    </Section>
  );
}

/**
 * The fixed base under the discretionary spending, and what has recently joined it.
 *
 * A charge seen twice inside four months counts as new: a subscription should
 * not have to run a third of a year before it is noticed, which is the whole
 * reason to watch for creep.
 */
export function RecurringCard({ recurring, fmt }: { recurring: AssessmentRecurringFacts; fmt: Money }) {
  if (recurring.items.length === 0) return null;
  const established = recurring.items.filter((i) => !i.isNew).slice(0, 6);

  return (
    <Section
      icon={Repeat}
      title="Recurring spend"
      subtitle="Charges that come back month after month, and anything new that has joined them."
      aside={
        recurring.monthlyBasePct !== null ? (
          <Chip tone={recurring.monthlyBasePct > 60 ? "warn" : "neutral"}>{recurring.monthlyBasePct}% of a month</Chip>
        ) : undefined
      }
    >
      {recurring.newItems.length > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-amber-light/40">
          <p className="text-[11px] font-medium tracking-wider text-amber-dark uppercase mb-2">New in the last 120 days</p>
          <ul className="space-y-1.5">
            {recurring.newItems.map((i) => (
              <li key={i.description} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-warm-700 truncate">{i.description}</span>
                <span className="text-warm-400 shrink-0 text-xs">
                  {fmt(i.avgAmount)} × {i.occurrences} since {i.firstSeen}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-1.5">
        {established.map((i) => (
          <li key={i.description} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-warm-600 truncate">{i.description}</span>
            <span className="text-warm-400 shrink-0 text-xs">
              {fmt(i.avgAmount)} · {i.months} months
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-warm-400 mt-3">
        About {fmt(recurring.monthlyBase)} a month goes to charges that come back every month. Not all of it is
        committed — some is simply habit.
      </p>
    </Section>
  );
}
