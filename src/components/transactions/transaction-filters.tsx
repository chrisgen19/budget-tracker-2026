"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  TransactionFilterDialog,
  type AdvancedFilterValues,
} from "@/components/transactions/transaction-filter-dialog";
import {
  TransactionFilterChips,
  buildFilterChips,
} from "@/components/transactions/transaction-filter-chips";
import { PeriodPicker } from "@/components/ui/period-picker";
import { useUser } from "@/components/user-provider";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useFilterToolbarScroll } from "@/hooks/use-filter-toolbar-scroll";
import { useTransactionFilterOptions } from "@/hooks/use-transaction-filter-options";
import { getCurrentMonth, type PeriodSelection, type PeriodType } from "@/lib/analytics-period";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";
import { cn, getCurrencySymbol } from "@/lib/utils";

export interface TransactionFilters {
  search: string;
  type: "ALL" | "INCOME" | "EXPENSE";
  /**
   * The selected window, mirroring the server filter schema field for field. The
   * selection endpoint is handed this object verbatim, so the shapes have to
   * match: `from`/`to` are null rather than "" because `validDateString` would
   * reject the empty string.
   */
  period: PeriodType;
  from: string | null;
  to: string | null;
  categoryId: string | null;
  labelId: string | null;
  /** Which surface created the row. "MCP" surfaces what the remote endpoint wrote. */
  createdVia: "ALL" | "APP" | "MCP" | "TELEGRAM";
  amountMin: number | null;
  amountMax: number | null;
  sortBy: "date" | "amount";
  sortDir: "asc" | "desc";
}

export interface TransactionFiltersBarProps {
  filters: TransactionFilters;
  onChange: Dispatch<SetStateAction<TransactionFilters>>;
  totalCount: number | null;
}

/** The picker speaks PeriodSelection; the filters mirror the wire format. */
export const periodOf = (filters: TransactionFilters): PeriodSelection => ({
  periodType: filters.period,
  from: filters.from ?? "",
  to: filters.to ?? "",
});

/** All time must carry no bounds — the filter schema refuses the combination. */
export const periodFilters = (selection: PeriodSelection): Pick<TransactionFilters, "period" | "from" | "to"> => ({
  period: selection.periodType,
  from: selection.from || null,
  to: selection.to || null,
});

const DEFAULT_FILTERS: Omit<TransactionFilters, "period" | "from" | "to"> = {
  search: "",
  type: "ALL",
  categoryId: null,
  labelId: null,
  createdVia: "ALL",
  amountMin: null,
  amountMax: null,
  sortBy: "date",
  sortDir: "desc",
};

const countAdvancedFilters = (filters: TransactionFilters) => {
  let count = 0;
  if (filters.categoryId) count += 1;
  if (filters.labelId) count += 1;
  if (filters.createdVia !== "ALL") count += 1;
  if (filters.amountMin !== null || filters.amountMax !== null) count += 1;
  if (filters.sortBy !== "date" || filters.sortDir !== "desc") count += 1;
  return count;
};

const hasActiveFilters = (filters: TransactionFilters) =>
  filters.search !== "" || filters.type !== "ALL" || countAdvancedFilters(filters) > 0;

export function TransactionFiltersBar({
  filters,
  onChange,
  totalCount,
}: TransactionFiltersBarProps) {
  const { user } = useUser();
  const currencySymbol = getCurrencySymbol(user.currency);
  const filterOptions = useTransactionFilterOptions(filters.type);
  const { categories, labels } = filterOptions;
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const { toolbarRef, markerRef, isScrolling, isInPlace, handleToolbarFocus } =
    useFilterToolbarScroll();

  const update = useCallback(
    (partial: Partial<TransactionFilters>) => {
      onChange((current) => ({ ...current, ...partial }));
    },
    [onChange],
  );

  const commitSearch = useCallback((search: string) => update({ search }), [update]);
  const search = useDebouncedSearch(filters.search, commitSearch);
  const { reset: resetSearchInput } = search;

  const previousTypeRef = useRef(filters.type);
  useEffect(() => {
    if (previousTypeRef.current === filters.type) return;
    previousTypeRef.current = filters.type;
    if (filters.categoryId) update({ categoryId: null });
  }, [filters.categoryId, filters.type, update]);

  const clearAll = () => {
    resetSearchInput();
    update(DEFAULT_FILTERS);
  };

  const applyAdvancedFilters = (values: AdvancedFilterValues) => {
    onChange((current) => ({ ...current, ...values }));
    setFilterDialogOpen(false);
  };

  const advancedCount = countAdvancedFilters(filters);
  const activeChips = buildFilterChips({
    filters,
    categoryName: categories.find((category) => category.id === filters.categoryId)?.name ?? null,
    labelName: labels.find((label) => label.id === filters.labelId)?.name ?? null,
    currencySymbol,
    update,
    onRemoveSearch: () => {
      resetSearchInput();
      update({ search: "" });
    },
  });

  return (
    <>
      {/* Marks the toolbar's own place in the page. While this is still on screen the
          toolbar has not scrolled under the header yet, so it does not move at all. */}
      <div ref={markerRef} data-filter-toolbar-marker aria-hidden="true" className="h-px -mb-px" />

      <section
        ref={toolbarRef}
        aria-label="Transaction filters"
        onFocusCapture={handleToolbarFocus}
        className={cn(
          "card z-20 mb-4 overflow-hidden border-cream-300/70 bg-white shadow-soft motion-reduce:transition-none",
          isInPlace
            // Its own space is still on screen, so it is an ordinary container: it
            // scrolls away with the list, does not pin itself under the header, and
            // never hides. No transition either — nothing changes up here.
            ? "relative translate-y-0 opacity-100 pointer-events-auto"
            // Its space has gone off the top, so it becomes a pinned overlay. It can
            // appear and disappear freely now: there is nothing on screen behind it
            // for the change to flash against.
            // Hidden carries no transition. Becoming an overlay pins it at the top of
            // the viewport, so animating *into* the hidden state means one frame with
            // the whole toolbar back in view at full opacity before it fades — a
            // flash of the entire bar every time the page scrolls past it.
            : isScrolling
              ? "sticky top-[61px] lg:top-0 pointer-events-none -translate-y-full opacity-0"
              : "sticky top-[61px] lg:top-0 pointer-events-auto translate-y-0 opacity-100 transition-all duration-300",
        )}
      >
        <div className="p-2.5 sm:p-3">
          <div className="flex items-center gap-2.5">
            <SearchField value={search.input} onChange={search.change} />

            <PeriodPicker
              value={periodOf(filters)}
              onChange={(next) => update(periodFilters(next))}
              tz={user.timezoneOffset}
              allowAllTime
              className="hidden sm:block"
            />

            <TypeToggle filters={filters} onChange={update} className="hidden lg:flex" />

            <FiltersButton count={advancedCount} expanded={filterDialogOpen} onClick={() => setFilterDialogOpen(true)} />
          </div>

          <div className="mt-2.5 flex items-center gap-2 sm:hidden">
            <PeriodPicker
              value={periodOf(filters)}
              onChange={(next) => update(periodFilters(next))}
              tz={user.timezoneOffset}
              allowAllTime
              className="min-w-0 flex-1"
            />
            <TypeToggle filters={filters} onChange={update} compact className="flex" />
          </div>

          <div className="mt-2.5 hidden items-center justify-end sm:flex lg:hidden">
            <TypeToggle filters={filters} onChange={update} className="flex" />
          </div>

          <div className="mt-2.5 flex min-w-0 items-center gap-2 border-t border-cream-100 pt-2.5">
            <ResultCount totalCount={totalCount} />
            <TransactionFilterChips chips={activeChips} onClearAll={hasActiveFilters(filters) ? clearAll : null} />
          </div>
        </div>
      </section>

      <TransactionFilterDialog open={filterDialogOpen} onClose={() => setFilterDialogOpen(false)} filters={filters} options={filterOptions} currencySymbol={currencySymbol} onApply={applyAdvancedFilters} />
    </>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div role="search" className="relative min-w-0 flex-1 sm:max-w-sm">
      <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-300" />
      <input
        type="search"
        value={value}
        maxLength={MAX_TRANSACTION_SEARCH_LENGTH}
        onChange={(event) => onChange(event.target.value.slice(0, MAX_TRANSACTION_SEARCH_LENGTH))}
        placeholder="Search transactions"
        aria-label="Search transactions"
        className="min-h-11 w-full rounded-xl border border-cream-200 bg-cream-50/60 py-2.5 pl-10 pr-12 text-sm text-warm-700 outline-none transition placeholder:text-warm-300 focus:border-amber focus:bg-white focus:ring-2 focus:ring-amber/20"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="absolute right-0 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-lg text-warm-300 transition-colors hover:bg-cream-100 hover:text-warm-600">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function FiltersButton({ count, expanded, onClick }: { count: number; expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count > 0 ? `Filters, ${count} active` : "Filters"}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className={cn(
        "relative inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors sm:px-4",
        count > 0
          ? "border-amber/40 bg-amber-light/30 text-amber-dark"
          : "border-cream-200 bg-white text-warm-500 hover:border-cream-300 hover:bg-cream-50 hover:text-warm-700",
      )}
    >
      <SlidersHorizontal className="h-[18px] w-[18px]" />
      <span className="hidden sm:inline">Filters</span>
      {count > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber px-1 text-[11px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function TypeToggle({
  filters,
  onChange,
  compact = false,
  className,
}: {
  filters: TransactionFilters;
  onChange: (partial: Partial<TransactionFilters>) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div aria-label="Transaction type" className={cn("shrink-0 items-center gap-0.5 rounded-xl bg-cream-100 p-1", className)}>
      {(["ALL", "INCOME", "EXPENSE"] as const).map((type) => (
        <button key={type} type="button" onClick={() => onChange({ type })} aria-label={compact ? type === "ALL" ? "All transactions" : type.toLowerCase() : undefined} aria-pressed={filters.type === type} className={cn("min-h-11 min-w-11 rounded-lg text-xs font-semibold transition-colors", compact ? "px-2" : "px-3", filters.type === type ? type === "INCOME" ? "bg-white text-income shadow-warm" : type === "EXPENSE" ? "bg-white text-expense shadow-warm" : "bg-white text-warm-700 shadow-warm" : "text-warm-400 hover:text-warm-600")}>
          {compact ? type === "ALL" ? "All" : type === "INCOME" ? "+" : "−" : type === "ALL" ? "All" : type === "INCOME" ? "Income" : "Expenses"}
        </button>
      ))}
    </div>
  );
}

function ResultCount({ totalCount }: { totalCount: number | null }) {
  return (
    <p aria-live="polite" className="shrink-0 text-xs font-medium text-warm-400">
      {totalCount === null
        ? "Loading…"
        : `${totalCount.toLocaleString()} ${totalCount === 1 ? "transaction" : "transactions"}`}
    </p>
  );
}
