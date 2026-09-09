"use client";

import { useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { QuickTileView } from "@/lib/telegram/tile-queries";
import {
  DropdownMenu,
  useDismissOnOutside,
  type DropdownItem,
} from "@/components/ui/dropdown-button";
import { usePrivacy } from "@/components/privacy-provider";
import { maskCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface QuickTileCardProps {
  tile: QuickTileView;
  currency: string;
  /** True while any tap on the grid is in flight, so a second one cannot start. */
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** True while a reorder is in flight, so a second move cannot be built from a stale grid. */
  reordering: boolean;
  onLog: (tile: QuickTileView) => void;
  onEdit: (tile: QuickTileView) => void;
  onDelete: (tile: QuickTileView) => void;
  onMove: (tile: QuickTileView, direction: -1 | 1) => void;
}

/**
 * One button.
 *
 * The card body logs and the overflow menu manages, which is the split that makes this page worth
 * visiting rather than a settings screen. The menu is a real sibling button rather than an overlay
 * on the card: nesting a button inside a button is invalid HTML and, more practically, a mis-tap
 * on the menu would write a transaction.
 */
export function QuickTileCard({
  tile,
  currency,
  busy,
  canMoveUp,
  canMoveDown,
  reordering,
  onLog,
  onEdit,
  onDelete,
  onMove,
}: QuickTileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(menuOpen, () => setMenuOpen(false), menuRef);
  const { hideAmounts } = usePrivacy();

  // Only the pins that will actually be written. One whose label was narrowed to the other
  // transaction type is shown struck through rather than dropped: it is still configured, and a
  // pin that silently stops applying is the failure this whole surface exists to make visible.
  const applied = tile.labels.filter((l) => l.applies);
  const stale = tile.labels.filter((l) => !l.applies);

  // Move up/down are omitted at the ends rather than disabled: a menu of four where two are dead
  // reads as broken, and the card's position already tells the user why they are gone.
  //
  // They are *disabled* while a reorder is in flight, which is a different thing and needs to
  // stay visible. The grid only updates when a reorder succeeds, so a second move started before
  // the first lands is built from the same stale order and sends an identical request -- the
  // user's second gesture silently discarded. Measured: two "Move down" presses inside one slow
  // response moved the tile once.
  const moveItems: DropdownItem[] = [
    ...(canMoveUp
      ? [{ label: "Move up", icon: ArrowUp, disabled: reordering, onClick: () => onMove(tile, -1) }]
      : []),
    ...(canMoveDown
      ? [
          {
            label: "Move down",
            icon: ArrowDown,
            disabled: reordering,
            onClick: () => onMove(tile, 1),
          },
        ]
      : []),
  ];

  const menuItems: DropdownItem[] = [
    { label: "Edit", icon: Pencil, onClick: () => onEdit(tile) },
    ...moveItems,
    { label: "Delete", icon: Trash2, onClick: () => onDelete(tile) },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onLog(tile)}
        disabled={busy}
        aria-label={
          tile.amount === null
            ? `${tile.label}, ask for an amount`
            : `${tile.label}, log ${maskCurrency(tile.amount, currency, hideAmounts)}`
        }
        // min-h-28 clears the 44px touch target with room to spare and gives the label two lines
        // before it truncates. pr-11 keeps the text off the overflow button sitting above it.
        className="flex min-h-28 w-full flex-col items-start justify-between gap-2 rounded-2xl border border-cream-300/70 bg-white p-4 pr-11 text-left shadow-warm transition hover:border-amber/50 hover:shadow-soft active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
      >
        <span className="line-clamp-2 text-sm font-medium leading-tight text-warm-700">
          {tile.label}
        </span>

        <span className="font-display text-xl font-semibold text-amber">
          {tile.amount === null ? (
            <span className="text-base text-warm-400">Ask each time</span>
          ) : (
            maskCurrency(tile.amount, currency, hideAmounts)
          )}
        </span>

        <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              "flex items-center gap-1 text-[11px]",
              tile.fallsBack ? "text-expense" : "text-warm-400"
            )}
          >
            {tile.fallsBack ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> : null}
            {tile.resolvedCategoryName ?? "no category"}
          </span>

          {applied.map((label) => (
            <span
              key={label.id}
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${label.color}1f`, color: label.color }}
            >
              {label.name}
            </span>
          ))}
          {stale.map((label) => (
            <span
              key={label.id}
              // Struck through and named, because "this label is configured and will not be
              // written" is the one state the user cannot discover any other way.
              title={`${label.name} no longer applies to ${tile.type === "INCOME" ? "income" : "expenses"}`}
              className="rounded-full bg-cream-200 px-1.5 py-0.5 text-[10px] font-medium text-warm-400 line-through"
            >
              {label.name}
            </span>
          ))}
        </span>
      </button>

      <div className="absolute right-2 top-2" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={`Actions for ${tile.label}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          // 32px is the visible control; the pseudo-element extends the hit area to the
          // 44x44 the design rules require, rather than growing the button and crowding
          // the card. `relative` is load-bearing: without it `before:inset-0` resolves
          // against the wrapper, which changes size when the menu opens.
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-warm-400 transition hover:bg-cream-200 hover:text-warm-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 before:absolute before:inset-0 before:-m-1.5 before:content-['']"
        >
          <Ellipsis className="h-4 w-4" />
        </button>
        <DropdownMenu open={menuOpen} items={menuItems} onSelect={() => setMenuOpen(false)} />
      </div>
    </div>
  );
}
