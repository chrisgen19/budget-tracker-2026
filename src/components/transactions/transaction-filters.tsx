"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  TransactionFilterDialog,
  type AdvancedFilterValues,
} from "@/components/transactions/transaction-filter-dialog";
import { buildFilterChips } from "@/components/transactions/transaction-filter-chips";
import {
  TransactionFilterRail,
  TransactionTypeToggle,
} from "@/components/transactions/transaction-filter-rail";
import { TransactionSummaryLine } from "@/components/transactions/transaction-summary-line";
import { PeriodPicker } from "@/components/ui/period-picker";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useFilterToolbarScroll } from "@/hooks/use-filter-toolbar-scroll";
import { useTransactionFilterOptions } from "@/hooks/use-transaction-filter-options";
import { useTransactionSummaryQuery } from "@/hooks/use-transactions";
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
  /**
   * The way back, when this visit came from somewhere that offers one.
   *
   * It rides in the toolbar rather than on the page heading because the toolbar is
   * this page's one piece of sticky chrome, and it has already solved every part of
   * staying put: where to pin (measured off the app header), its own place in the
   * flow, re-measuring when its height changes, hiding while the page scrolls and
   * returning when it stops, and never hiding on desktop. On the heading it would
   * scroll away, and an installed PWA opened cold on this URL has no browser back
   * button to fall back on.
   *
   * Inline at the head of the first row rather than on a bordered row of its own,
   * which cost a whole line on a phone to hold one 16px arrow.
   */
  returnBar?: ReactNode;
  /**
   * Bumped by the page whenever the URL rewrites the filters from outside.
   *
   * The search box needs to hear about that even when the committed search is
   * unchanged either side of it — typing on a drill-down that had no search and
   * then navigating leaves `filters.search` at "" throughout, so nothing the
   * field itself watches would tell it that its pending commit is now obsolete.
   */
  filtersRevision?: number;
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
  returnBar,
  filtersRevision,
}: TransactionFiltersBarProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const currencySymbol = getCurrencySymbol(user.currency);
  // Owned here rather than passed down from the page: the bar already holds both
  // halves of the key, and the totals are read nowhere else.
  const summaryQuery = useTransactionSummaryQuery(filters, user.timezoneOffset);
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
  const search = useDebouncedSearch(filters.search, commitSearch, filtersRevision);
  const { reset: resetSearchInput } = search;

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
            {returnBar}
            <SearchField value={search.input} onChange={search.change} />

            <PeriodPicker
              value={periodOf(filters)}
              onChange={(next) => update(periodFilters(next))}
              tz={user.timezoneOffset}
              allowAllTime
              className="hidden sm:block"
            />

            <TransactionTypeToggle
              value={filters.type}
              onChange={(type) => update({ type, categoryId: null })}
              className="hidden lg:flex"
            />

            <FiltersButton count={advancedCount} expanded={filterDialogOpen} onClick={() => setFilterDialogOpen(true)} />
          </div>

          <TransactionFilterRail
            period={periodOf(filters)}
            onPeriodChange={(next) => update(periodFilters(next))}
            type={filters.type}
            onTypeChange={(type) => update({ type, categoryId: null })}
            tz={user.timezoneOffset}
            chips={activeChips}
            onClearAll={hasActiveFilters(filters) ? clearAll : null}
          />

          {/* No rule above it: at text-xs in warm-400 the line is already quiet
              enough to read as a footnote, and a border cost 17px of a phone
              screen to say what the type contrast says for free. */}
          <div className="mt-2 flex min-w-0 items-center">
            <TransactionSummaryLine
              summary={summaryQuery.data}
              isError={summaryQuery.isError}
              currency={user.currency}
              hideAmounts={hideAmounts}
            />
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
