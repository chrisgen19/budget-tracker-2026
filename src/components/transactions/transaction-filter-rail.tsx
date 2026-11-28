"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  TransactionFilterChips,
  type FilterChip,
} from "@/components/transactions/transaction-filter-chips";
import type { TransactionFilters } from "@/components/transactions/transaction-filters";
import { Modal } from "@/components/ui/modal";
import { PeriodPicker } from "@/components/ui/period-picker";
import type { PeriodSelection } from "@/lib/analytics-period";
import { cn, TOUCH_HIT_AREA } from "@/lib/utils";

type TransactionType = TransactionFilters["type"];

/**
 * One button, two widths. The compact glyphs used to come from a second copy of
 * the whole toggle rendered at a different breakpoint — three copies existed in
 * all — and the copies drifted: only the compact one carried an `aria-label`, so
 * the screen-reader name for the same control changed with the viewport. Both
 * spellings now live on one element, and the accessible name is the full word at
 * every width.
 */
const TYPE_LABELS: Record<TransactionType, { full: string; compact: string }> = {
  ALL: { full: "All", compact: "All" },
  INCOME: { full: "Income", compact: "+" },
  EXPENSE: { full: "Expenses", compact: "−" },
};

const TYPE_NAMES: Record<TransactionType, string> = {
  ALL: "All transactions",
  INCOME: "Income",
  EXPENSE: "Expenses",
};

const TYPE_ORDER = ["ALL", "INCOME", "EXPENSE"] as const;

/**
 * Pressing the type already showing returns without calling `onChange` at all.
 * Passing the same value is not the same as doing nothing: the update builds a
 * fresh filters object, and the page watches that object by identity to reset the
 * page number, drop the selection and announce "cleared because the filters
 * changed" — all of it untrue here.
 *
 * Shared by the segmented toggle and the phone menu rather than written twice:
 * the two are the same control at different widths, and a rule only one of them
 * follows is the kind of drift that put three diverging copies of the toggle in
 * here before.
 */
const selectType = (
  next: TransactionType,
  current: TransactionType,
  onChange: (type: TransactionType) => void,
) => {
  if (next !== current) onChange(next);
};

/** The colour cue alone, for the menu trigger, which has no fill to carry it. */
const typeTextClass = (type: TransactionType) =>
  type === "INCOME" ? "text-income" : type === "EXPENSE" ? "text-expense" : "text-warm-700";

const activeTypeClass = (type: TransactionType) =>
  type === "INCOME"
    ? "bg-white text-income shadow-warm"
    : type === "EXPENSE"
      ? "bg-white text-expense shadow-warm"
      : "bg-white text-warm-700 shadow-warm";

export function TransactionTypeToggle({
  value,
  onChange,
  dense = false,
  className,
}: {
  value: TransactionType;
  onChange: (type: TransactionType) => void;
  /** Rail sizing: 36px tall, 44px hit area. See PeriodPicker's `dense`. */
  dense?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-label="Transaction type"
      className={cn(
        "shrink-0 items-center rounded-xl bg-cream-100",
        // Dense drops the 2px gaps between segments (the active one is marked by its fill
        // anyway): with the short month label it is what lets the rail fit a 360px phone.
        dense ? "gap-0 rounded-lg p-0.5" : "gap-0.5 p-1",
        className,
      )}
    >
      {TYPE_ORDER.map((type) => (
        // Dropping the category belongs here, on the control the user actually
        // pressed, rather than in an effect watching `filters.type`. An effect
        // cannot tell a press apart from the same field arriving with a restored
        // URL, and would strip the category out of a drill-down being navigated
        // back to. The category list is scoped to the type, so a category chosen
        // under one type either matches nothing under another or shows a chip
        // that cannot resolve to a name — but only an actual *switch* invalidates
        // it. `selectType` above is what makes "only a switch" true.
        <button
          key={type}
          type="button"
          onClick={() => selectType(type, value, onChange)}
          aria-label={TYPE_NAMES[type]}
          aria-pressed={value === type}
          className={cn(
            "relative min-w-11 rounded-lg px-2 text-xs font-semibold transition-colors sm:px-3",
            dense ? `h-9 ${TOUCH_HIT_AREA}` : "min-h-11",
            value === type ? activeTypeClass(type) : "text-warm-400 hover:text-warm-600",
          )}
        >
          <span className="sm:hidden">{TYPE_LABELS[type].compact}</span>
          <span className="hidden sm:inline">{TYPE_LABELS[type].full}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The same control as `TransactionTypeToggle`, collapsed to one button for the
 * narrowest phones.
 *
 * The segmented toggle cannot be made to fit 320px. Its three segments are
 * `min-w-11` because 44px is the touch floor, so the control is 136px wide and
 * cannot shrink without breaking that rule; with the dense period picker beside
 * it the rail needs 305px of the 266px a 320px screen leaves, and scrolls by 39px
 * (measured). One button costs about 58px, which is what puts the rail back
 * inside the screen with room to spare.
 *
 * It opens a `Modal` rather than the `DropdownMenu` the rest of the app uses for
 * this shape, and not by preference: the toolbar is `overflow-hidden` and becomes
 * a transformed, `sticky` containing block while the page scrolls, which clips an
 * absolutely positioned panel away entirely. That is the same clipping the dense
 * `PeriodPicker` beside it answers with `presentation="dialog"`, and `e2e/modal-
 * clipping.spec.ts` pins the toolbar as still being such an ancestor.
 */
export function TransactionTypeMenuButton({
  value,
  onChange,
  className,
}: {
  value: TransactionType;
  onChange: (type: TransactionType) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The name is the control plus its state, not the state alone: "Expenses"
        // on its own is indistinguishable from the segment of the same name one
        // breakpoint up, and says nothing about what pressing it does.
        aria-label={`Transaction type, currently ${TYPE_NAMES[value]}`}
        className={cn(
          "relative flex h-9 shrink-0 items-center gap-1 rounded-lg bg-cream-100 px-2.5 text-xs font-semibold transition-colors",
          TOUCH_HIT_AREA,
          typeTextClass(value),
          className,
        )}
      >
        <span>{TYPE_LABELS[value].full}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-warm-400" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Transaction type">
        <div className="flex flex-col gap-1 p-2">
          {TYPE_ORDER.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                selectType(type, value, onChange);
                setOpen(false);
              }}
              aria-pressed={value === type}
              className={cn(
                "flex min-h-11 items-center justify-between gap-3 rounded-xl px-4 text-sm font-semibold transition-colors",
                value === type ? "bg-cream-100" : "hover:bg-cream-50",
                typeTextClass(type),
              )}
            >
              <span>{TYPE_NAMES[type]}</span>
              {value === type && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

interface TransactionFilterRailProps {
  period: PeriodSelection;
  onPeriodChange: (next: PeriodSelection) => void;
  type: TransactionType;
  onTypeChange: (type: TransactionType) => void;
  tz: number;
  chips: FilterChip[];
  onClearAll: (() => void) | null;
}

/**
 * The toolbar's second row: everything that narrows the list and did not fit
 * beside the search box, in one horizontally scrollable rail.
 *
 * It replaces three separate rows — a mobile period + type row, a tablet-only
 * type row, and a chips row — each of which cost a full 44px line on a phone and
 * two of which rendered the same toggle at a different breakpoint. Which controls
 * appear is still a breakpoint question, but it is answered by hiding items
 * inside one row rather than by stacking rows.
 *
 * The scroll container carries 2px of vertical padding for a reason that is easy
 * to undo by accident: `overflow-x: auto` forces the other axis to `auto` too, so
 * it clips vertically, and the 44px hit areas on 36px chips overhang by exactly
 * 4px. Without that padding the top and bottom 4px of every target in here is cut
 * off — invisibly, since the pseudo-elements have no paint.
 */
export function TransactionFilterRail({
  period,
  onPeriodChange,
  type,
  onTypeChange,
  tz,
  chips,
  onClearAll,
}: TransactionFilterRailProps) {
  return (
    <div
      data-filter-rail
      className={cn(
        "mt-2 flex items-center gap-2",
        // At `lg` the period picker and the type toggle have both moved up to the
        // search row, so with neither a chip nor a Clear all there is nothing left
        // in here to show. Clear all is checked separately rather than inferred
        // from the chips: a category filter whose name has not loaded yet is
        // active with no chip to show for it, and the way out of it still has to
        // be reachable.
        chips.length === 0 && !onClearAll && "lg:hidden",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 sm:gap-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PeriodPicker
          value={period}
          onChange={onPeriodChange}
          tz={tz}
          allowAllTime
          dense
          // No fixed width: a flex item sizes to its max-content, so the month
          // label is never truncated by a guess about how long a month name is.
          className="shrink-0 sm:hidden"
        />
        {/* One control, two shapes, and only ever one of them mounted as far as
            the user is concerned. Below `sm` the segmented toggle does not fit,
            so the menu button stands in; from `sm` to `lg` the toggle is back;
            at `lg` both go, because the search row carries the toggle itself. */}
        <TransactionTypeMenuButton value={type} onChange={onTypeChange} className="sm:hidden" />
        <TransactionTypeToggle
          value={type}
          onChange={onTypeChange}
          dense
          className="hidden sm:flex lg:hidden"
        />
        <TransactionFilterChips chips={chips} />
      </div>

      {/* Pinned outside the scroller: with enough chips to scroll, a Clear all at
          the far end is the one control the user most needs and least can reach. */}
      {onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className={cn(
            "relative h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-warm-400 transition-colors hover:bg-cream-100 hover:text-warm-700",
            TOUCH_HIT_AREA,
          )}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
