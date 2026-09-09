"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Zap } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionFab } from "@/components/ui/action-fab";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/components/user-provider";
import { QuickTileCard } from "@/components/quick-log/quick-tile-card";
import { QuickTileForm } from "@/components/quick-log/quick-tile-form";
import { AmountPrompt } from "@/components/quick-log/amount-prompt";
import { FrequentSuggestions } from "@/components/quick-log/frequent-suggestions";
import {
  QuickLogError,
  useCreateQuickTile,
  useDeleteQuickTile,
  useFrequentTilesQuery,
  useLogQuickTile,
  useQuickTilesQuery,
  useReorderQuickTiles,
  useUpdateQuickTile,
} from "@/hooks/use-quick-tiles";
import type { QuickTileView } from "@/lib/telegram/tile-queries";
import type { TelegramQuickTileInput } from "@/lib/validations";

/**
 * Where unresolved taps are held across a reload.
 *
 * `sessionStorage` rather than `localStorage`: an unresolved write belongs to this sitting, and a
 * key surviving until tomorrow would replay against a row the user has long since forgotten.
 *
 * Unscoped by user on purpose. A slot is keyed by tile id, tile ids are globally unique, and they
 * are never shared between accounts -- so a leftover entry from a previous login can match
 * nothing, and the worst it can do is sit there until the tab closes.
 */
const PENDING_TAPS_KEY = "quick-log:pending-taps";

/** Identity of a tap: the same button for the same figure is the same intent. */
const tapSlot = (tileId: string, amount: number) => `${tileId}:${amount}`;

/** Every read and write is guarded: a private window or blocked site data throws on access. */
const readPendingTaps = (): Record<string, string> => {
  try {
    const raw = sessionStorage.getItem(PENDING_TAPS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    // Only string values survive: a malformed entry must not become a clientBatchId.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, value]) => typeof value === "string"
      )
    ) as Record<string, string>;
  } catch {
    return {};
  }
};

const writePendingTaps = (taps: Record<string, string>) => {
  try {
    if (Object.keys(taps).length === 0) sessionStorage.removeItem(PENDING_TAPS_KEY);
    else sessionStorage.setItem(PENDING_TAPS_KEY, JSON.stringify(taps));
  } catch {
    // Storage being unavailable costs the reload-safety, not the tap.
  }
};

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
  const logTile = useLogQuickTile();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuickTileView | null>(null);
  const [draft, setDraft] = useState<Partial<TelegramQuickTileInput> | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuickTileView | null>(null);
  const [asking, setAsking] = useState<QuickTileView | null>(null);

  /**
   * An idempotency key per unresolved tap, held until that tap is settled.
   *
   * A key is kept across a failure and replayed rather than regenerated, because a 5xx or a lost
   * response means the write may have committed: posting again under a fresh key would write a
   * second row. A 4xx releases it, since the route raises those before it opens a transaction, so
   * nothing was written and the next attempt is a genuinely new intent. This is the rule the
   * multi-scan review already follows for a batch save.
   *
   * Keyed by the tap rather than held as one value, and both halves of that are load-bearing.
   * *Keyed*, because a single page-scoped key would be picked up by a tap on a different button
   * and replay the wrong row. *One per tap rather than one at a time*, because the grid stays
   * usable after a failure: with a single slot, tapping a second button overwrites the first
   * tap's key and settling that second tap discards it, so re-pressing the first button posts a
   * fresh key and writes a duplicate of a row that had already committed.
   *
   * They accumulate only for the page's lifetime, and only for taps whose fate is genuinely
   * unknown -- at most a handful, each reusable by nothing but an identical re-press.
   */
  const pending = useRef<Record<string, string>>({});

  // Restored after a reload, because React state is not where an unresolved write can live.
  // A tap whose outcome is unknown keeps its key precisely so a re-press replays instead of
  // writing a second row -- and "the request failed, let me refresh" is the most natural thing a
  // user does next, which discarded the only copy of that key.
  //
  // Restored keys are *reused*, never auto-replayed: nothing is posted until the user presses the
  // same button for the same figure again, which is a deliberate act. That is the difference from
  // the Mini App's `pending-log.ts`, which restores a whole draft on launch and so has to offer it.
  useEffect(() => {
    pending.current = readPendingTaps();
  }, []);

  /**
   * Claim and release, both **synchronous** and both independent of this component's lifetime.
   *
   * A ref and a direct write, not state and a passive effect, and the release half is what forces
   * it. `releaseTap` runs when the request settles, which can be *after the page has unmounted* --
   * tapping a button and immediately going to Transactions to look at it is an ordinary thing to
   * do. A `setPending` there is discarded, the effect never runs, and the settled key stays in
   * storage. Coming back and buying the same thing again then replays the **old** transaction:
   * measured end to end, two real purchases wrote one row and the confirmation read "Already
   * logged". A duplicate at least shows up in the ledger; a missing row does not.
   *
   * Claiming is written before the request goes out for the mirror-image reason, so the durable
   * record never lags the thing it exists to describe.
   *
   * Nothing renders from this, so state was buying a re-render and two lifetime hazards for
   * nothing.
   */
  const claimTap = (slot: string): string => {
    const existing = pending.current[slot];
    if (existing) return existing;

    const key = crypto.randomUUID();
    pending.current = { ...pending.current, [slot]: key };
    writePendingTaps(pending.current);
    return key;
  };

  const releaseTap = (slot: string) => {
    const { [slot]: _settled, ...rest } = pending.current;
    pending.current = rest;
    writePendingTaps(rest);
  };

  const tiles = data?.tiles ?? [];
  const maxTiles = data?.limits.maxTiles ?? 0;
  const atLimit = maxTiles > 0 && tiles.length >= maxTiles;
  const busy = logTile.isPending;

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

  const runLog = async (tile: QuickTileView, amount: number) => {
    // Reused only for a re-press of the *same* tap. Anything else is a new intent, gets a new key,
    // and leaves whatever other taps are still unresolved exactly where they are. Claimed -- and
    // written to storage -- before the request goes out, never after.
    const slot = tapSlot(tile.id, amount);
    const clientBatchId = claimTap(slot);

    try {
      const result = await logTile.mutateAsync({
        tileId: tile.id,
        description: tile.description,
        amount,
        type: tile.type,
        clientBatchId,
      });

      releaseTap(slot);
      setAsking(null);

      const labels = result.labels.length > 0 ? `, ${result.labels.join(", ")}` : "";
      showToast(
        result.replayed
          ? `Already logged: ${result.description}`
          : `Logged ${result.description} to ${result.categoryName}${labels}`
      );
    } catch (error) {
      // A 4xx wrote nothing, so the pin is dropped and a corrected retry is a new intent. Anything
      // else may have committed, so the pin is kept and the next attempt replays it.
      if (error instanceof QuickLogError && error.wrote === "no") releaseTap(slot);
      showToast(error instanceof Error ? error.message : "Could not log that");
    }
  };

  const handleTap = (tile: QuickTileView) => {
    // A tile with no amount asks for one; the pad is the only place that figure exists. Keys
    // retained from earlier taps are deliberately *not* cleared here: each names the tap it
    // belongs to, so none can be picked up by this one, and dropping one would lose the replay
    // for a write whose fate is still unknown.
    if (tile.amount === null) {
      setAsking(tile);
      return;
    }
    // The amount sent is ignored server-side for a fixed tile - the stored figure is the authority.
    // Sending it anyway keeps one payload shape for both paths.
    void runLog(tile, tile.amount);
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
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-warm-700 sm:text-3xl">Quick Log</h1>
          <p className="mt-1 text-sm text-warm-400">
            One tap for the things you buy every week. The same buttons appear in your Telegram
            mini app.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openNew()}
          disabled={atLimit || isError}
          className="hidden min-h-11 shrink-0 items-center gap-2 rounded-xl bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-dark disabled:opacity-50 sm:inline-flex"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New Button
        </button>
      </header>

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
                    onLog={handleTap}
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
        atLimit={atLimit}
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

      <Modal open={asking !== null} onClose={() => setAsking(null)} title={asking?.label ?? ""}>
        {asking ? (
          <AmountPrompt
            label={asking.label}
            currency={user.currency}
            busy={busy}
            onSubmit={(amount) => void runLog(asking, amount)}
            onCancel={() => setAsking(null)}
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
