"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useUser } from "@/components/user-provider";
import { QuickTileChip } from "@/components/quick-log/quick-tile-chip";
import { AmountPrompt } from "@/components/quick-log/amount-prompt";
import { useQuickTilesQuery } from "@/hooks/use-quick-tiles";
import { useQuickTap } from "@/hooks/use-quick-tap";

/**
 * How many buttons the dashboard carries before deferring to `/quick-log`.
 *
 * The grid holds up to `MAX_QUICK_TILES` (12), which is a phone-grid's worth and more than a
 * glance. Six is what fits a desktop row without wrapping twice and what a thumb can reach on a
 * phone before the scroll stops being a scroll.
 *
 * *Which* six is not a decision this component makes: tiles arrive in `sortOrder`, so reorder on
 * `/quick-log` is already the control for what appears here. That is the whole reason there is no
 * setting for it.
 */
const STRIP_LIMIT = 6;

/**
 * The quick-log buttons, on the screen the app opens to.
 *
 * `/dashboard` is the manifest `start_url`, so a button here is one tap from a cold launch of the
 * installed app. Before this the same buttons were three actions deep on a phone -- land on the
 * dashboard, open the tab bar's More menu, then Quick Log -- which made the web app slower than
 * the Telegram Mini App at the one thing quick logging exists for.
 *
 * **This surface logs and does not manage.** No edit, no delete, no reorder, no overflow menu.
 * `quick-tile-writes.ts` keeps one rule set behind two auth doors and that is worth protecting: a
 * third caller that can edit is a third place the tile cap, the duplicate-label refusal and the
 * label rules can come to disagree. A mis-tap here writes a transaction, which is visible in the
 * ledger and deletable; it can never destroy a button.
 *
 * The tap itself is `useQuickTap`, the same hook `/quick-log` uses, so the idempotency rules exist
 * once. They share one `sessionStorage` key too, which is the correct reading of an unresolved
 * tap: it belongs to the tab, so one started here stays replayable from `/quick-log`.
 */
export function QuickLogStrip() {
  const { user } = useUser();
  const { data, isError } = useQuickTilesQuery();
  const { tap, asking, closeAsk, submitAsk, busy } = useQuickTap();

  const tiles = data?.tiles ?? [];

  // Silent in three cases, and the error one is the case that matters. A failed tile fetch leaves
  // `tiles` empty, and rendering a "no buttons yet" panel on the dashboard would report a network
  // problem as a fact about the account -- while the buttons sit on `/quick-log` where the same
  // page distinguishes those two states carefully. Nothing beats a wrong answer here.
  //
  // No shimmer either, and that rests on something outside this file: `dashboard/page.tsx` starts
  // this same query at the top of the page so it runs alongside the much heavier dashboard read
  // that gates everything behind a skeleton. This component mounts *inside* that gate, so without
  // the head start it could not even begin until the dashboard read had finished, and would then
  // drop in late shoving Upcoming Bills down. Given the head start the tiles are already here, and
  // a placeholder would only be a promise the empty case then breaks.
  if (isError || tiles.length === 0) return null;

  return (
    <section className="card mb-8 p-4 sm:p-5" aria-labelledby="quick-log-strip-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-light">
            <Zap className="h-4 w-4 text-amber" aria-hidden />
          </div>
          <h2 id="quick-log-strip-heading" className="text-sm font-medium text-warm-700">
            Quick log
          </h2>
        </div>

        {/* The visible control is a line of text; the pseudo-element carries it to the 44px
            target AGENTS.md requires, rather than growing the row to a finger's height. Same
            trick the profile switches and the card's overflow button use, and `relative` is
            load-bearing: without it `inset-x-0` resolves against the header row instead. */}
        <Link
          href="/quick-log"
          className="relative shrink-0 text-xs font-medium text-amber transition-colors hover:text-amber-dark before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
        >
          {tiles.length > STRIP_LIMIT ? `All ${tiles.length}` : "Manage"} &rarr;
        </Link>
      </div>

      {/* The same horizontal-snap pattern the summary cards above already use, so the dashboard
          scrolls the same way twice rather than inventing a second gesture. It stays a scroller at
          every width: six chips fit a desktop row, and `flex-wrap` would reflow them into a ragged
          second line at the awkward widths in between. */}
      <div className="scrollbar-hide -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
        {tiles.slice(0, STRIP_LIMIT).map((tile) => (
          <QuickTileChip
            key={tile.id}
            tile={tile}
            currency={user.currency}
            busy={busy}
            onLog={tap}
          />
        ))}
      </div>

      {/* Owned here rather than by the dashboard, so mounting the strip is one line and the page
          does not have to know that some buttons ask for a figure. */}
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
    </section>
  );
}
