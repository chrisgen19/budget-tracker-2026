"use client";

import { useState } from "react";
import { Plus, PiggyBank } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ActionFab } from "@/components/ui/action-fab";
import { useToast } from "@/components/ui/toast";
import { GoalForm } from "@/components/goals/goal-form";
import { ContributionForm } from "@/components/goals/contribution-form";
import { GoalCard, GoalsSummaryBar } from "@/components/goals/goal-card";
import {
  useAddGoalContribution,
  useCreateSavingsGoal,
  useDeleteSavingsGoal,
  useSavingsGoals,
  useUpdateSavingsGoal,
} from "@/hooks/use-savings-goals";
import type {
  SavingsGoalContributionInput,
  SavingsGoalInput,
} from "@/lib/validations";
import type { SavingsGoalSummary } from "@/types";

/**
 * Savings goals and sinking funds.
 *
 * Money here is assigned on purpose. A positive net cash flow is money that happened not to be
 * spent, which the dashboard already shows; this page is the other thing, and the two are kept
 * apart deliberately - a contribution is never written as a transaction, so it cannot appear in a
 * category report as though it had been spent.
 */
export default function GoalsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SavingsGoalSummary | null>(null);
  const [contributing, setContributing] = useState<SavingsGoalSummary | null>(null);
  const [deleting, setDeleting] = useState<SavingsGoalSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [saveError, setSaveError] = useState("");

  const { showToast } = useToast();
  const { data: goals = [], isLoading, isError, refetch } = useSavingsGoals(showArchived);
  const createGoal = useCreateSavingsGoal();
  const updateGoal = useUpdateSavingsGoal();
  const deleteGoal = useDeleteSavingsGoal();
  const addContribution = useAddGoalContribution();

  const closeAll = () => {
    setShowForm(false);
    setEditing(null);
    setContributing(null);
  };

  // The refusal is rendered, never swallowed. A duplicate name is a 409 the user can act on, and
  // a modal that simply stays open with the name it would not accept reads as a broken button.
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setSaveError("");
    try {
      await action();
      closeAll();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : fallback);
    }
  };

  const handleCreate = (input: SavingsGoalInput) =>
    run(() => createGoal.mutateAsync(input), "Failed to create goal");

  const handleUpdate = (input: SavingsGoalInput) =>
    editing ? run(() => updateGoal.mutateAsync({ id: editing.id, patch: input }), "Failed to save goal") : Promise.resolve();

  const handleContribute = (input: SavingsGoalContributionInput) =>
    contributing
      ? run(() => addContribution.mutateAsync({ id: contributing.id, input }), "Failed to save contribution")
      : Promise.resolve();

  /**
   * Archive is the one action fired with no modal open, so it cannot use `saveError` - that is
   * only rendered inside the three dialogs, and routing this through `run()` sent the failure
   * somewhere nothing displays it. A failed archive left the button reading "Archive" and the goal
   * where it was, which is the silent rollback `AGENTS.md` has a rule against.
   */
  const toggleArchive = async (goal: SavingsGoalSummary) => {
    const archiving = goal.status !== "ARCHIVED";
    try {
      await updateGoal.mutateAsync({
        id: goal.id,
        patch: { status: archiving ? "ARCHIVED" : "ACTIVE" },
      });
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : `Could not ${archiving ? "archive" : "restore"} "${goal.name}". Please try again.`,
        "error",
      );
    }
  };

  const openCreate = () => {
    setSaveError("");
    setShowForm(true);
  };

  return (
    <div>
      <PageHeader
        title="Savings goals"
        description="Money set aside on purpose, and whether it is getting there in time."
        action={
          <button
            onClick={openCreate}
            className="hidden sm:inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-5 py-2.5 rounded-xl transition-colors shadow-soft hover:shadow-soft-md"
          >
            <Plus className="w-4 h-4" />
            New Goal
          </button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="card h-52 animate-pulse bg-cream-50/60" />
          ))}
        </div>
      ) : isError ? (
        <div className="card p-6 text-center">
          <h2 className="font-serif text-lg text-warm-700">Couldn&apos;t load your goals</h2>
          <p className="mt-1 text-sm text-warm-400">Nothing has changed. Try again.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber px-4 py-2 text-sm font-medium text-white hover:bg-amber-dark"
          >
            Try again
          </button>
        </div>
      ) : goals.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="No savings goals yet"
          description="A goal turns money you did not spend into money you meant to save, and the Watchlist will tell you when one falls behind."
          action={
            <button
              onClick={openCreate}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-dark"
            >
              <Plus className="h-4 w-4" />
              New Goal
            </button>
          }
        />
      ) : (
        <>
          <GoalsSummaryBar goals={goals} />
          <div className="grid gap-4 sm:grid-cols-2">
            {goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onContribute={() => {
                  setSaveError("");
                  setContributing(goal);
                }}
                onEdit={() => {
                  setSaveError("");
                  setEditing(goal);
                }}
                onArchive={() => toggleArchive(goal)}
                onDelete={() => setDeleting(goal)}
              />
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setShowArchived((shown) => !shown)}
        className="mt-6 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-warm-500 hover:bg-cream-100"
      >
        {showArchived ? "Hide archived goals" : "Show archived goals"}
      </button>

      <ActionFab onClick={openCreate} label="New goal" icon={Plus} />

      <Modal open={showForm} onClose={closeAll} title="New savings goal">
        {saveError && <SaveError message={saveError} />}
        <GoalForm onSubmit={handleCreate} onCancel={closeAll} />
      </Modal>

      <Modal open={editing !== null} onClose={closeAll} title="Edit goal">
        {saveError && <SaveError message={saveError} />}
        <GoalForm goal={editing} onSubmit={handleUpdate} onCancel={closeAll} />
      </Modal>

      <Modal open={contributing !== null} onClose={closeAll} title="Add money">
        {saveError && <SaveError message={saveError} />}
        {contributing && (
          <ContributionForm
            goalName={contributing.name}
            onSubmit={handleContribute}
            onCancel={closeAll}
          />
        )}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          // Without `onError` a failed delete cleared the spinner and left this dialog sitting
          // there saying nothing, which reads as the Delete button not working.
          deleteGoal.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
            onError: (error) =>
              showToast(
                error instanceof Error ? error.message : `Could not delete "${deleting.name}". Please try again.`,
                "error",
              ),
          });
        }}
        title="Delete goal?"
        message={`"${deleting?.name}" will be removed. It has no contributions, so nothing saved is lost.`}
        confirmLabel="Delete"
        loading={deleteGoal.isPending}
      />
    </div>
  );
}

function SaveError({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-xl border border-expense/20 bg-expense-light px-4 py-3 text-sm text-expense-dark">
      {message}
    </div>
  );
}
