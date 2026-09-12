"use client";

import { useState } from "react";
import { Plus, Zap } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionFab } from "@/components/ui/action-fab";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/components/user-provider";
import { QuickTileCard } from "@/components/quick-log/quick-tile-card";
import { QuickTileForm } from "@/components/quick-log/quick-tile-form";
import { AmountPrompt } from "@/components/quick-log/amount-prompt";
import { FrequentSuggestions } from "@/components/quick-log/frequent-suggestions";
import {
  useCreateQuickTile,
  useDeleteQuickTile,
  useFrequentTilesQuery,
  useQuickTilesQuery,
  useReorderQuickTiles,
  useUpdateQuickTile,
} from "@/hooks/use-quick-tiles";
import { useQuickTap } from "@/hooks/use-quick-tap";
import type { QuickTileView } from "@/lib/telegram/tile-queries";
import type { TelegramQuickTileInput } from "@/lib/validations";

/**
 * Quick Log - the buttons that turn a routine expense into one tap.
 *
 * These are the same rows the Telegram Mini App's grid renders, so a button made here is on the
 * phone's grid on its next launch. This is the editor for both, and the only place a button's
 * labels can be pinned.
 */
export default function QuickLogPage() {
  const { user } = useUser();
  const { showToast } = useToast();

  const { data, isLoading, isError, refetch } = useQuickTilesQuery();
  const { data: frequent = [], isLoading: frequentLoading } = useFrequentTilesQuery();

  const createTile = useCreateQuickTile();
  const updateTile = useUpdateQuickTile();
  const deleteTile = useDeleteQuickTile();
  const reorderTiles = useReorderQuickTiles();

  // Tapping lives in a hook because the dashboard strip taps the same buttons. Every rule it
  // holds was a bug first, so a second hand-written copy is a second chance to reintroduce one.
  const { tap, asking, closeAsk, submitAsk, busy } = useQuickTap();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuickTileView | null>(null);
  const [draft, setDraft] = useState<Partial<TelegramQuickTileInput> | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuickTileView | null>(null);

  const tiles = data?.tiles ?? [];
  const maxTiles = data?.limits.maxTiles ?? 0;
  const atLimit = maxTiles > 0 && tiles.length >= maxTiles;

  const openNew = (prefill?: Partial<TelegramQuickTileInput>) => {
    setEditing(null);
    setDraft(prefill ?? null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (tile: QuickTileView) => {
    setEditing(tile);
    setDraft(null);
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setDraft(null);
    setFormError(null);
  };

  const handleSubmit = async (input: TelegramQuickTileInput) => {
    setFormError(null);
    try {
      if (editing) {
        await updateTile.mutateAsync({ id: editing.id, input });
      } else {
        await createTile.mutateAsync(input);
      }
      closeForm();
    } catch (error) {
      // The form stays open carrying what was typed. Every refusal here names a cause the user can
      // act on - a duplicate name, a label that no longer applies - and closing would discard both
      // the message and the work.
      setFormError(error instanceof Error ? error.message : "Could not save the button");
    }
  };

  const handleMove = (tile: QuickTileView, direction: -1 | 1) => {
    const index = tiles.findIndex((t) => t.id === tile.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= tiles.length) return;

    // The whole set, in the order the user now wants it. A moved id and a position would have to
    // be interpreted against whatever the server currently holds, and two moves in flight would be
    // interpreted differently.
    const next = [...tiles];
    [next[index], next[target]] = [next[target], next[index]];

    reorderTiles.mutate(
      next.map((t) => t.id),
      { onError: (error) => showToast(error.message) }
    );
  };

  const handleDelete = () => {
    if (!deleting) return;
    deleteTile.mutate(deleting.id, {
      onSuccess: () => {
        showToast(`${deleting.label} deleted`);
        setDeleting(null);
      },
      onError: (error) => {
        showToast(error.message);
        setDeleting(null);
      },
    });
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Quick Log"
        description="One tap for the things you buy every week. The same buttons appear in your Telegram mini app."
        action={
          <button
            type="button"
            onClick={() => openNew()}
            disabled={atLimit || isError}
            className="hidden min-h-11 shrink-0 items-center gap-2 rounded-xl bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-dark disabled:opacity-50 sm:inline-flex"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New Button
          </button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 animate-shimmer rounded-2xl bg-cream-200" />
          ))}
        </div>
      ) : isError ? (
        // Distinct from the empty state on purpose. A failed load leaves `tiles` empty, so without
        // this the page reads as "you have no buttons" and offers to create one -- which then
        // fails on a duplicate label, because the buttons are there and were simply never fetched.
        <div className="rounded-2xl border border-cream-300/70 bg-white p-8 text-center shadow-warm">
          <p className="text-sm text-warm-500">We could not load your buttons.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-dark"
          >
            Try again
          </button>
        </div>
      ) : tiles.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No quick buttons yet"
          description="Make a button for something you log every week - a fare, a coffee, the usual lunch - and it becomes one tap."
          action={
            <button
              type="button"
              onClick={() => openNew()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-dark"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Create a button
            </button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {tiles.map((tile, index) => (
                <motion.div key={tile.id} layout>
                  <QuickTileCard
                    tile={tile}
                    currency={user.currency}
                    busy={busy}
                    canMoveUp={index > 0}
                    canMoveDown={index < tiles.length - 1}
                    reordering={reorderTiles.isPending}
                    onLog={tap}
                    onEdit={openEdit}
                    onDelete={setDeleting}
                    onMove={handleMove}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {atLimit ? (
            <p className="mt-3 text-xs text-warm-400">
              {maxTiles} buttons is the most that fits a phone grid. Delete one to add another.
            </p>
          ) : null}
        </>
      )}

      <FrequentSuggestions
        entries={frequent}
        currency={user.currency}
        loading={frequentLoading}
        // `isError` too: with the tile list unknown, `atLimit` cannot be computed, so a
        // suggestion would open a form that may be refused for a cap the page cannot see. The
        // header button and the FAB are gated the same way.
        atLimit={atLimit || isError}
        onMakeButton={(entry) =>
          openNew({
            // The description is the most recent spelling the user actually wrote, so it makes a
            // reasonable button name as well as the note. The amount is offered only when it is
            // stable enough to log on one tap; otherwise the button is left asking.
            label: entry.description.slice(0, 40),
            description: entry.description,
            amount: entry.amountIsStable ? entry.amount : null,
            type: "EXPENSE",
            categoryId: entry.categoryId,
          })
        }
      />

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editing ? "Edit button" : "New button"}
      >
        {/* Keyed on the tile being edited so the form remounts with fresh defaults rather than
            holding the previous one's values through react-hook-form's own state. */}
        <QuickTileForm
          key={editing?.id ?? "new"}
          defaults={
            editing
              ? {
                  label: editing.label,
                  description: editing.description,
                  amount: editing.amount,
                  type: editing.type,
                  categoryId: editing.categoryId,
                  labelIds: editing.labels.map((l) => l.id),
                }
              : (draft ?? undefined)
          }
          submitLabel={editing ? "Save" : "Create"}
          onSubmit={handleSubmit}
          onCancel={closeForm}
          error={formError}
        />
      </Modal>

      <Modal open={asking !== null} onClose={closeAsk} title={asking?.label ?? ""}>
        {asking ? (
          <AmountPrompt
            label={asking.label}
            currency={user.currency}
            busy={busy}
            onSubmit={submitAsk}
            onCancel={closeAsk}
          />
        ) : null}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this button?"
        message={
          <>
            <strong>{deleting?.label}</strong> will be removed from here and from your Telegram
            mini app. Transactions it already logged are not affected.
          </>
        }
        confirmLabel="Delete"
        loading={deleteTile.isPending}
      />

      <ActionFab
        label="Button"
        icon={Plus}
        onClick={() => openNew()}
        suppressed={atLimit || isError || formOpen || asking !== null || deleting !== null}
      />
    </div>
  );
}
