"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  TransactionFilterDialog,
  type AdvancedFilterValues,
} from "@/components/transactions/transaction-filter-dialog";
import {
  TransactionFilterChips,
  buildFilterChips,
} from "@/components/transactions/transaction-filter-chips";
import { TransactionMonthDialog } from "@/components/transactions/transaction-month-dialog";
import { useUser } from "@/components/user-provider";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";
import { useFilterToolbarScroll } from "@/hooks/use-filter-toolbar-scroll";
import { useTransactionFilterOptions } from "@/hooks/use-transaction-filter-options";
import { accountMonthKey } from "@/lib/account-time";
import { cn, getCurrencySymbol } from "@/lib/utils";

export interface TransactionFilters {
  search: string;
  type: "ALL" | "INCOME" | "EXPENSE";
  month: string;
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

const DEFAULT_FILTERS: Omit<TransactionFilters, "month"> = {
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

const getMonthLabel = (month: string) => {
  if (month === "ALL") return "All time";
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1)));
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
  const [monthDialogOpen, setMonthDialogOpen] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(() =>
    Number(filters.month === "ALL" ? accountMonthKey(new Date(), user.timezoneOffset).slice(0, 4) : filters.month.slice(0, 4)),
  );
  const { toolbarRef, markerRef, isScrolling, handleToolbarFocus } = useFilterToolbarScroll();

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

  const navigateMonth = (direction: -1 | 1) => {
    if (filters.month === "ALL") {
      update({ month: accountMonthKey(new Date(), user.timezoneOffset) });
      return;
    }
    const [year, monthNumber] = filters.month.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, monthNumber - 1 + direction, 1));
    update({
      month: `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`,
    });
  };

  const openMonthDialog = () => {
    const startingMonth =
      filters.month === "ALL" ? accountMonthKey(new Date(), user.timezoneOffset) : filters.month;
    setMonthPickerYear(Number(startingMonth.slice(0, 4)));
    setMonthDialogOpen(true);
  };

  const selectMonth = (month: string) => {
    update({ month });
    setMonthDialogOpen(false);
  };

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
          "card sticky top-[61px] lg:top-0 z-20 mb-4 overflow-hidden border-cream-300/70 bg-white shadow-soft motion-reduce:transition-none",
          // The transition stays on at every position. Nothing animates while the
          // toolbar is in its own place because nothing changes up there — the hook
          // never sets the hiding state — and keeping it means crossing back over
          // the boundary fades in instead of snapping from invisible to visible.
          isScrolling
            ? "pointer-events-none -translate-y-full opacity-0 transition-all duration-100"
            : "pointer-events-auto translate-y-0 opacity-100 transition-all duration-300",
        )}
      >
        <div className="p-2.5 sm:p-3">
          <div className="flex items-center gap-2.5">
            <SearchField value={search.input} onChange={search.change} />

            <MonthNavigator filters={filters} onNavigate={navigateMonth} onOpenPicker={openMonthDialog} className="hidden sm:flex" />

            <TypeToggle filters={filters} onChange={update} className="hidden lg:flex" />

            <FiltersButton count={advancedCount} expanded={filterDialogOpen} onClick={() => setFilterDialogOpen(true)} />
          </div>

          <div className="mt-2.5 flex items-center gap-2 sm:hidden">
            <MonthNavigator filters={filters} onNavigate={navigateMonth} onOpenPicker={openMonthDialog} className="flex min-w-0 flex-1" />
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
      <TransactionMonthDialog open={monthDialogOpen} onClose={() => setMonthDialogOpen(false)} year={monthPickerYear} onYearChange={setMonthPickerYear} selectedMonth={filters.month} currentMonth={accountMonthKey(new Date(), user.timezoneOffset)} onSelect={selectMonth} />
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
        onChange={(event) => onChange(event.target.value)}
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

function MonthNavigator({
  filters,
  onNavigate,
  onOpenPicker,
  className,
}: {
  filters: TransactionFilters;
  onNavigate: (direction: -1 | 1) => void;
  onOpenPicker: () => void;
  className?: string;
}) {
  return (
    <div className={cn("items-center justify-between rounded-xl border border-cream-200 bg-cream-50/60 p-0.5", className)}>
      <button type="button" onClick={() => onNavigate(-1)} aria-label="Previous month" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" onClick={onOpenPicker} aria-label={`Choose month, ${getMonthLabel(filters.month)}`} aria-haspopup="dialog" className="relative flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-warm-600 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/20 sm:min-w-32">
        <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-warm-400" />
        <span className="min-w-0 select-none truncate text-center">
          {getMonthLabel(filters.month)}
        </span>
      </button>
      <button type="button" onClick={() => onNavigate(1)} aria-label="Next month" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
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
