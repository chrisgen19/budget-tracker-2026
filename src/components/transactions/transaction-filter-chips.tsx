"use client";

import { X } from "lucide-react";
import {
  SOURCE_CHIP_LABELS,
  getSortLabel,
} from "@/components/transactions/transaction-filter-options";
import type { TransactionFilters } from "@/components/transactions/transaction-filters";
import { cn, TOUCH_HIT_AREA } from "@/lib/utils";

export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

interface BuildFilterChipsParams {
  filters: TransactionFilters;
  /** Resolved names, or null while the options are still loading or the id is unknown. */
  categoryName: string | null;
  labelName: string | null;
  currencySymbol: string;
  update: (partial: Partial<TransactionFilters>) => void;
  /** Clearing search also has to drop the pending debounce, which only the bar owns. */
  onRemoveSearch: () => void;
}

const amountChipLabel = (min: number | null, max: number | null, symbol: string) => {
  if (min !== null && max !== null) return `${symbol}${min}–${symbol}${max}`;
  if (min !== null) return `${symbol}${min}+`;
  return `Up to ${symbol}${max}`;
};

/**
 * One chip per narrowing the user applied, in the order the toolbar presents them.
 * A category or label whose name has not loaded yet yields no chip: a chip reading
 * "Category: undefined" is worse than none, and the filter is still shown as active
 * by the Filters button's count.
 */
export function buildFilterChips({
  filters,
  categoryName,
  labelName,
  currencySymbol,
  update,
  onRemoveSearch,
}: BuildFilterChipsParams): FilterChip[] {
  const candidates: (FilterChip | null)[] = [
    filters.search
      ? { id: "search", label: `Search: ${filters.search}`, onRemove: onRemoveSearch }
      : null,
    filters.type !== "ALL"
      ? {
          id: "type",
          label: filters.type === "INCOME" ? "Income" : "Expenses",
          // Same rule as the type toggle: the category list is scoped to the
          // type, so widening the type drops a category chosen under it.
          onRemove: () => update({ type: "ALL", categoryId: null }),
        }
      : null,
    categoryName
      ? {
          id: "category",
          label: `Category: ${categoryName}`,
          onRemove: () => update({ categoryId: null }),
        }
      : null,
    labelName
      ? { id: "label", label: `Label: ${labelName}`, onRemove: () => update({ labelId: null }) }
      : null,
    filters.createdVia !== "ALL"
      ? {
          id: "source",
          label: SOURCE_CHIP_LABELS[filters.createdVia],
          onRemove: () => update({ createdVia: "ALL" }),
        }
      : null,
    filters.amountMin !== null || filters.amountMax !== null
      ? {
          id: "amount",
          label: `Amount: ${amountChipLabel(filters.amountMin, filters.amountMax, currencySymbol)}`,
          onRemove: () => update({ amountMin: null, amountMax: null }),
        }
      : null,
    filters.sortBy !== "date" || filters.sortDir !== "desc"
      ? {
          id: "sort",
          label: `Sort: ${getSortLabel(filters.sortBy, filters.sortDir)}`,
          onRemove: () => update({ sortBy: "date", sortDir: "desc" }),
        }
      : null,
  ];

  return candidates.filter((chip): chip is FilterChip => chip !== null);
}

interface TransactionFilterChipsProps {
  chips: FilterChip[];
}

/**
 * The chips themselves and nothing else — no scroll container and no Clear all.
 *
 * Both of those moved out to the filter rail, which places the chips after the
 * period and type controls in one scrollable row and pins Clear all outside it.
 * Owning the wrapper here meant the chips could only ever be their own row.
 *
 * 36px tall to match the rail's other chips, with the 44px target kept as a
 * pseudo-element on the remove button. That button also holds a real 44px width,
 * since a hit area can be stretched vertically without colliding with anything
 * but would overlap its neighbours horizontally.
 */
export function TransactionFilterChips({ chips }: TransactionFilterChipsProps) {
  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-amber-light/35 pl-3 text-xs font-medium text-amber-dark"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove ${chip.label} filter`}
            className={cn(
              "relative flex h-9 w-11 items-center justify-center rounded-full transition-colors hover:bg-amber/15",
              TOUCH_HIT_AREA,
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
    </>
  );
}
