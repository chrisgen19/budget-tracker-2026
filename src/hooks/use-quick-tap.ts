"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { QuickLogError, useLogQuickTile } from "@/hooks/use-quick-tiles";
import {
  claimPendingTap,
  readPendingTaps,
  releasePendingTap,
  tapSlot,
  type PendingTap,
} from "@/components/quick-log/pending-taps";
import type { QuickTileView } from "@/lib/telegram/tile-queries";

/**
 * Tapping a quick-log button, wherever the button is rendered.
 *
 * Extracted out of `/quick-log` when the dashboard grew a strip of the same buttons. There are now
 * two surfaces that log and there will be more, and the alternative was copying the idempotency
 * rules below into each one -- which is the drift `quick-tile-writes.ts` exists to prevent on the
 * server, applied to the half of the problem that lives on the client. Every rule here was a bug
 * first, so a second hand-written copy is a second chance to reintroduce one.
 *
 * What is deliberately *not* here: creating, editing, deleting and reordering. The chrome logs and
 * `/quick-log` manages, so a surface that only taps needs only this.
 */
export function useQuickTap() {
  const { showToast } = useToast();
  const logTile = useLogQuickTile();

  /** The tile waiting on a figure, or null. Only an `amount === null` tile ever lands here. */
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
   * Reuse is bounded by `PENDING_TAP_TTL_MS`. Without a boundary, an identical press hours later
   * is treated as a retry of the failed one: the server replays the original transaction and the
   * new purchase is never recorded.
   *
   * The store behind it is one `sessionStorage` key, so every surface in the tab shares it. That
   * is the correct reading of an unresolved tap: it belongs to the tab, not to whichever page
   * happened to start it, and a tap begun on the dashboard must stay replayable from `/quick-log`.
   *
   * Which is exactly why this ref is a **mirror and not the record**. Claim and release both
   * read-modify-write the shared store (`claimPendingTap` / `releasePendingTap`), because an
   * in-flight `runLog` outlives the page that started it: a dashboard tap settling after the user
   * has followed the Manage link would otherwise write this stale copy back and delete a key
   * `/quick-log` claimed in between. What the ref is still good for is a browser that refuses
   * storage outright, where the shared read answers `{}` and a retry would have no key at all.
   */
  const pending = useRef<Record<string, PendingTap>>({});

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
   * Claim and release, both **synchronous** and both independent of the caller's lifetime.
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
   *
   * Both delegate to `pending-taps.ts` rather than editing the record here. The rules they enforce
   * -- reuse only inside the window, and never clobber another surface's claims -- are testable
   * there and are not testable in a hook.
   */
  const claimTap = (slot: string): string => {
    const { key, taps } = claimPendingTap(pending.current, slot);
    pending.current = taps;
    return key;
  };

  const releaseTap = (slot: string) => {
    pending.current = releasePendingTap(pending.current, slot);
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

  /** A press on a button. Either it logs, or it asks for the one figure it is missing. */
  const tap = (tile: QuickTileView) => {
    // A tile with no amount asks for one; the prompt is the only place that figure exists. Keys
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

  return {
    tap,
    /** The tile waiting on a figure. Render `AmountPrompt` for it. */
    asking,
    closeAsk: () => setAsking(null),
    submitAsk: (amount: number) => {
      if (asking) void runLog(asking, amount);
    },
    /** True while any tap is in flight, so a second one cannot start. */
    busy: logTile.isPending,
  };
}
