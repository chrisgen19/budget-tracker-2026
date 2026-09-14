"use client";

import {
  TransactionFilterChips,
  type FilterChip,
} from "@/components/transactions/transaction-filter-chips";
import type { TransactionFilters } from "@/components/transactions/transaction-filters";
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
        "shrink-0 items-center gap-0.5 rounded-xl bg-cream-100",
        dense ? "rounded-lg p-0.5" : "p-1",
        className,
      )}
    >
      {(["ALL", "INCOME", "EXPENSE"] as const).map((type) => (
        // Dropping the category belongs here, on the control the user actually
        // pressed, rather than in an effect watching `filters.type`. An effect
        // cannot tell a press apart from the same field arriving with a restored
        // URL, and would strip the category out of a drill-down being navigated
        // back to. The category list is scoped to the type, so a category chosen
        // under one type either matches nothing under another or shows a chip
        // that cannot resolve to a name — but only an actual *switch* invalidates
        // it.
        //
        // Re-pressing the type already showing returns without calling onChange
        // at all. Passing the same value is not the same as doing nothing: the
        // update builds a fresh filters object, and the page watches that object
        // by identity to reset the page number, drop the selection and announce
        // "cleared because the filters changed" — all of it untrue here.
        <button
          key={type}
          type="button"
          onClick={() => {
            if (type !== value) onChange(type);
          }}
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
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        <TransactionTypeToggle
          value={type}
          onChange={onTypeChange}
          dense
          className="flex lg:hidden"
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
