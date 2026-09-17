"use client";

import { Archive, Pencil, PiggyBank, Plus, RotateCcw, Trash2 } from "lucide-react";
import { cn, maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import type { SavingsGoalPace, SavingsGoalSummary } from "@/types";

/**
 * How each pace state is shown, and the wording for it.
 *
 * `no-deadline` is deliberately neutral rather than reassuring. Progress is knowable without a
 * target date and pace is not, and dressing that up as "on track" would be the one answer here
 * that is actively misleading.
 */
const PACE_STYLE: Record<SavingsGoalPace["state"], { label: string; className: string }> = {
  funded: { label: "Funded", className: "bg-income-light text-income-dark" },
  "on-track": { label: "On track", className: "bg-income-light text-income-dark" },
  behind: { label: "Behind pace", className: "bg-amber-light text-amber-dark" },
  stalled: { label: "Not started", className: "bg-amber-light text-amber-dark" },
  overdue: { label: "Past its date", className: "bg-expense-light text-expense-dark" },
  "no-deadline": { label: "No deadline", className: "bg-cream-200 text-warm-500" },
};

const paceLine = (goal: SavingsGoalSummary, money: (amount: number) => string): string => {
  const { pace } = goal;
  switch (pace.state) {
    case "funded":
      return "Fully funded.";
    case "no-deadline":
      return `${money(pace.remaining)} to go. Set a target date to track pace.`;
    case "overdue":
      return `${money(pace.remaining)} short, and the target date has passed.`;
    case "stalled":
      return `${money(pace.remaining)} to go in ${pace.daysRemaining} days. Nothing put aside yet.`;
    default:
      return `${money(pace.remaining)} to go. Needs ${money(pace.requiredMonthly ?? 0)} a month; going in at ${money(pace.observedMonthly ?? 0)}.`;
  }
};

interface GoalCardProps {
  goal: SavingsGoalSummary;
  onContribute: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function GoalCard({ goal, onContribute, onEdit, onArchive, onDelete }: GoalCardProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const money = (amount: number) => maskCurrency(amount, user.currency, hideAmounts);
  const pace = PACE_STYLE[goal.pace.state];
  const archived = goal.status === "ARCHIVED";

  return (
    <article className={cn("card p-4 sm:p-5", archived && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-lg text-warm-700">{goal.name}</h3>
          <p className="text-xs text-warm-400">
            {goal.kind === "SINKING_FUND" ? "Sinking fund" : "Goal"}
            {goal.targetDate && ` · by ${goal.targetDate}`}
          </p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", pace.className)}>
          {archived ? "Archived" : pace.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-warm-600">
        <span className="font-medium text-warm-700">{money(goal.funded)}</span> of {money(goal.targetAmount)}
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-cream-200"
        role="progressbar"
        aria-valuenow={goal.fundedPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${goal.name} progress`}
      >
        <div
          className={cn("h-full rounded-full", goal.pace.state === "funded" ? "bg-income" : "bg-amber")}
          style={{ width: `${goal.fundedPct}%` }}
        />
      </div>

      <p className="mt-2 text-sm text-warm-500">{paceLine(goal, money)}</p>
      {goal.pace.projectedCompletion && goal.pace.state === "behind" && (
        <p className="mt-0.5 text-xs text-warm-400">
          At this rate it lands around {goal.pace.projectedCompletion}.
        </p>
      )}
      {goal.notes && <p className="mt-2 text-xs text-warm-400">{goal.notes}</p>}

      <div className="mt-2 flex flex-wrap gap-1">
        {!archived && (
          <button
            type="button"
            onClick={onContribute}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-amber-dark hover:bg-amber-light"
          >
            <Plus className="h-4 w-4" /> Add money
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-warm-600 hover:bg-cream-100"
        >
          <Pencil className="h-4 w-4" /> Edit
        </button>
        <button
          type="button"
          onClick={onArchive}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-warm-600 hover:bg-cream-100"
        >
          {archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {archived ? "Restore" : "Archive"}
        </button>
        {/*
          Delete is only offered for a goal with no history. Archiving is the answer for one that
          has been funded: deleting it takes the contributions with it (`onDelete: Cascade`), and
          "where did my savings record go" is not a question a confirm dialog can un-ask.
        */}
        {goal.contributionCount === 0 && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-expense hover:bg-expense-light"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
      </div>
    </article>
  );
}

export function GoalsSummaryBar({ goals }: { goals: SavingsGoalSummary[] }) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const active = goals.filter((goal) => goal.status !== "ARCHIVED");
  if (active.length === 0) return null;

  const money = (amount: number) => maskCurrency(amount, user.currency, hideAmounts);
  const funded = active.reduce((total, goal) => total + goal.funded, 0);
  const target = active.reduce((total, goal) => total + goal.targetAmount, 0);
  const offPace = active.filter(
    (goal) => goal.pace.state === "behind" || goal.pace.state === "stalled" || goal.pace.state === "overdue",
  ).length;

  return (
    <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 sm:p-5">
      <PiggyBank className="h-5 w-5 text-amber" aria-hidden="true" />
      <p className="text-sm text-warm-600">
        <span className="font-medium text-warm-700">{money(funded)}</span> put aside of {money(target)}
      </p>
      <p className="text-sm text-warm-400">
        {active.length} active {active.length === 1 ? "goal" : "goals"}
        {offPace > 0 && ` · ${offPace} needing attention`}
      </p>
    </div>
  );
}
