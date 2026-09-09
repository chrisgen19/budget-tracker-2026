"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { QuickLogError, useLogQuickTile } from "@/hooks/use-quick-tiles";
import {
  claimPendingTap,
  releasePendingTap,
  tapSlot,
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
   * One tap: claim a key, post, settle it.
   *
   * `claimPendingTap` and `releasePendingTap` are called directly and this hook keeps **no** copy
   * of the record between them. It used to hold a ref seeded from storage on mount, and that ref
   * was the root cause of three separate bugs found in review on #276 -- a release computed from
   * it deleted another surface's claim, merging it back in resurrected a slot storage had settled,
   * and a surface mounted after a failed write started empty and lost the claim outright. All
   * three are one mistake: a per-instance copy of state that is not per-instance. The record lives
   * in `pending-taps.ts` at module scope, which is the scope it actually has -- shared by every
   * surface in the tab, gone on a reload -- and it is testable there without a DOM harness.
   *
   * Both calls are synchronous and independent of this component's lifetime, which is what forced
   * the question in the first place: the release runs when the request settles, and that can be
   * *after the page has unmounted*, since tapping a button and going straight to Transactions is
   * an ordinary thing to do. Held in React state the update was discarded, the effect never ran,
   * and the settled key stayed behind; coming back and buying the same thing again replayed the
   * old transaction. Two real purchases, one row, "Already logged".
   *
   * Nothing renders from any of this, which is also why there is no state here to render from.
   */
  const runLog = async (tile: QuickTileView, amount: number) => {
    // Reused only for a re-press of the *same* tap. Anything else is a new intent, gets a new key,
    // and leaves whatever other taps are still unresolved exactly where they are. Claimed -- and
    // written to storage -- before the request goes out, never after.
    const slot = tapSlot(tile.id, amount);
    const { key: clientBatchId } = claimPendingTap(slot);

    try {
      const result = await logTile.mutateAsync({
        tileId: tile.id,
        description: tile.description,
        amount,
        type: tile.type,
        clientBatchId,
      });

      releasePendingTap(slot);
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
      if (error instanceof QuickLogError && error.wrote === "no") releasePendingTap(slot);
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
