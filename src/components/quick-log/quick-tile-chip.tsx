"use client";

import { AlertTriangle } from "lucide-react";
import type { QuickTileView } from "@/lib/telegram/tile-queries";
import { usePrivacy } from "@/components/privacy-provider";
import { maskCurrency } from "@/lib/utils";

interface QuickTileChipProps {
  tile: QuickTileView;
  currency: string;
  /** True while any tap is in flight, so a second one cannot start. */
  busy: boolean;
  onLog: (tile: QuickTileView) => void;
}

/**
 * One quick-log button, at the density the chrome can afford.
 *
 * `QuickTileCard` is the same row rendered for the page that *manages* buttons: category text,
 * label pills, struck-through stale pins and an overflow menu. That density is right where you
 * edit and wrong where you glance and tap, so this is a second component rather than a `variant`
 * prop on the first -- they share the type and nothing else, and the one thing they must not share
 * is the menu. The chrome logs and `/quick-log` manages, so a mis-tap here can write a transaction
 * and can never delete a button.
 *
 * The fallback warning survives the trim even though the category name does not. A tile whose
 * category was deleted files somewhere the label does not say, and `resolvedCategoryName` is
 * carried on every read precisely so that is visible before the tap rather than after it. Dropping
 * it here would put the one state the user cannot discover any other way behind a visit to
 * another page.
 */
export function QuickTileChip({ tile, currency, busy, onLog }: QuickTileChipProps) {
  const { hideAmounts } = usePrivacy();

  const amountText =
    tile.amount === null ? null : maskCurrency(tile.amount, currency, hideAmounts);

  return (
    <button
      type="button"
      onClick={() => onLog(tile)}
      disabled={busy}
      title={
        tile.fallsBack
          ? `Files to ${tile.resolvedCategoryName ?? "no category"}, not where this button says`
          : undefined
      }
      aria-label={
        amountText === null
          ? `${tile.label}, ask for an amount`
          : `${tile.label}, log ${amountText}`
      }
      // w-[7.5rem] rather than a flex ratio: the parent scrolls horizontally on mobile, and a
      // shrinking chip would squeeze the last one into a sliver instead of letting it run off the
      // edge, which is the affordance that says there are more.
      className="flex w-[7.5rem] shrink-0 snap-start flex-col items-start justify-between gap-1.5 rounded-xl border border-cream-300/70 bg-cream-50 p-3 text-left transition hover:border-amber/50 hover:bg-white active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
    >
      <span className="flex w-full items-start gap-1">
        {tile.fallsBack ? (
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-expense" aria-hidden />
        ) : null}
        <span className="line-clamp-2 text-xs font-medium leading-tight text-warm-600">
          {tile.label}
        </span>
      </span>

      {amountText === null ? (
        <span className="text-[11px] text-warm-400">Ask each time</span>
      ) : (
        <span className="font-display text-base font-semibold tabular-nums text-amber">
          {amountText}
        </span>
      )}
    </button>
  );
}
