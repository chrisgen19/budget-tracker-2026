"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
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
import { TransactionMonthDialog } from "@/components/transactions/transaction-month-dialog";
import { useUser } from "@/components/user-provider";
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

const SORT_OPTIONS = [
  { label: "Newest first", sortBy: "date" as const, sortDir: "desc" as const },
  { label: "Oldest first", sortBy: "date" as const, sortDir: "asc" as const },
  { label: "Highest amount", sortBy: "amount" as const, sortDir: "desc" as const },
  { label: "Lowest amount", sortBy: "amount" as const, sortDir: "asc" as const },
];

const SOURCE_CHIP_LABELS: Record<Exclude<TransactionFilters["createdVia"], "ALL">, string> = {
  APP: "Source: In app",
  MCP: "Source: Claude",
  TELEGRAM: "Source: Telegram",
};

const DESKTOP_QUERY = "(min-width: 640px)";

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
  const [searchInput, setSearchInput] = useState(filters.search);
  const [isScrolling, setIsScrolling] = useState(false);
  const toolbarRef = useRef<HTMLElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const update = useCallback(
    (partial: Partial<TransactionFilters>) => {
      onChange((current) => ({ ...current, ...partial }));
    },
    [onChange],
  );

  const cancelSearchDebounce = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = undefined;
  }, []);

  const previousTypeRef = useRef(filters.type);
  useEffect(() => {
    if (previousTypeRef.current === filters.type) return;
    previousTypeRef.current = filters.type;
    if (filters.categoryId) update({ categoryId: null });
  }, [filters.categoryId, filters.type, update]);

  useEffect(() => setSearchInput(filters.search), [filters.search]);
  useEffect(() => cancelSearchDebounce, [cancelSearchDebounce]);

  // Match ActionFab's mobile-only scroll behaviour: get the overlay out of the
  // reader's way, unless the toolbar owns focus, then return it once scrolling settles.
  useEffect(() => {
    const desktopQuery = window.matchMedia(DESKTOP_QUERY);

    const handleScroll = () => {
      if (desktopQuery.matches || toolbarRef.current?.contains(document.activeElement)) {
        setIsScrolling(false);
        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
          scrollTimerRef.current = undefined;
        }
        return;
      }

      setIsScrolling(true);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = undefined;
        setIsScrolling(false);
      }, 180);
    };

    const handleBreakpointChange = () => {
      if (desktopQuery.matches) setIsScrolling(false);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    desktopQuery.addEventListener("change", handleBreakpointChange);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      desktopQuery.removeEventListener("change", handleBreakpointChange);
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = undefined;
      }
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    cancelSearchDebounce();
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = undefined;
      update({ search: value });
    }, 300);
  };

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
      filters.month === "ALL"
        ? accountMonthKey(new Date(), user.timezoneOffset)
        : filters.month;
    setMonthPickerYear(Number(startingMonth.slice(0, 4)));
    setMonthDialogOpen(true);
  };

  const selectMonth = (month: string) => {
    update({ month });
    setMonthDialogOpen(false);
  };

  const clearAll = () => {
    cancelSearchDebounce();
    update(DEFAULT_FILTERS);
    setSearchInput("");
  };

  const openFilterDialog = () => {
    setFilterDialogOpen(true);
  };

  const applyAdvancedFilters = (values: AdvancedFilterValues) => {
    onChange((current) => ({ ...current, ...values }));
    setFilterDialogOpen(false);
  };

  const selectedCategory = filters.categoryId
    ? categories.find((category) => category.id === filters.categoryId)
    : null;
  const selectedLabel = filters.labelId
    ? labels.find((label) => label.id === filters.labelId)
    : null;
  const currentSortLabel =
    SORT_OPTIONS.find(
      (option) => option.sortBy === filters.sortBy && option.sortDir === filters.sortDir,
    )?.label ?? "Newest first";
  const advancedCount = countAdvancedFilters(filters);

  const activeChips: { id: string; label: string; onRemove: () => void }[] = [];
  if (filters.search) {
    activeChips.push({
      id: "search",
      label: `Search: ${filters.search}`,
      onRemove: () => {
        cancelSearchDebounce();
        update({ search: "" });
        setSearchInput("");
      },
    });
  }
  if (filters.type !== "ALL") {
    activeChips.push({
      id: "type",
      label: filters.type === "INCOME" ? "Income" : "Expenses",
      onRemove: () => update({ type: "ALL" }),
    });
  }
  if (selectedCategory) {
    activeChips.push({
      id: "category",
      label: `Category: ${selectedCategory.name}`,
      onRemove: () => update({ categoryId: null }),
    });
  }
  if (selectedLabel) {
    activeChips.push({
      id: "label",
      label: `Label: ${selectedLabel.name}`,
      onRemove: () => update({ labelId: null }),
    });
  }
  if (filters.createdVia !== "ALL") {
    activeChips.push({
      id: "source",
      label: SOURCE_CHIP_LABELS[filters.createdVia],
      onRemove: () => update({ createdVia: "ALL" }),
    });
  }
  if (filters.amountMin !== null || filters.amountMax !== null) {
    const amountLabel =
      filters.amountMin !== null && filters.amountMax !== null
        ? `${currencySymbol}${filters.amountMin}–${currencySymbol}${filters.amountMax}`
        : filters.amountMin !== null
          ? `${currencySymbol}${filters.amountMin}+`
          : `Up to ${currencySymbol}${filters.amountMax}`;
    activeChips.push({
      id: "amount",
      label: `Amount: ${amountLabel}`,
      onRemove: () => update({ amountMin: null, amountMax: null }),
    });
  }
  if (filters.sortBy !== "date" || filters.sortDir !== "desc") {
    activeChips.push({
      id: "sort",
      label: `Sort: ${currentSortLabel}`,
      onRemove: () => update({ sortBy: "date", sortDir: "desc" }),
    });
  }

  return (
    <>
      <section
        ref={toolbarRef}
        aria-label="Transaction filters"
        onFocusCapture={() => setIsScrolling(false)}
        className={cn(
          "card sticky top-[61px] lg:top-0 z-20 mb-4 overflow-hidden border-cream-300/70 bg-white shadow-soft motion-reduce:transition-none",
          isScrolling
            ? "pointer-events-none -translate-y-full opacity-0 transition-all duration-100"
            : "pointer-events-auto translate-y-0 opacity-100 transition-all duration-300",
        )}
      >
        <div className="p-2.5 sm:p-3">
          <div className="flex items-center gap-2.5">
            <div role="search" className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-300" />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Search transactions"
                aria-label="Search transactions"
                className="min-h-11 w-full rounded-xl border border-cream-200 bg-cream-50/60 py-2.5 pl-10 pr-12 text-sm text-warm-700 outline-none transition placeholder:text-warm-300 focus:border-amber focus:bg-white focus:ring-2 focus:ring-amber/20"
              />
              {searchInput && (
                <button type="button" onClick={() => handleSearchChange("")} aria-label="Clear search" className="absolute right-0 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-lg text-warm-300 transition-colors hover:bg-cream-100 hover:text-warm-600">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <MonthNavigator
              filters={filters}
              onNavigate={navigateMonth}
              onOpenPicker={openMonthDialog}
              className="hidden sm:flex"
            />

            <TypeToggle filters={filters} onChange={update} className="hidden lg:flex" />

            <button
              type="button"
              onClick={openFilterDialog}
              aria-label={advancedCount > 0 ? `Filters, ${advancedCount} active` : "Filters"}
              aria-haspopup="dialog"
              aria-expanded={filterDialogOpen}
              className={cn(
                "relative inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors sm:px-4",
                advancedCount > 0
                  ? "border-amber/40 bg-amber-light/30 text-amber-dark"
                  : "border-cream-200 bg-white text-warm-500 hover:border-cream-300 hover:bg-cream-50 hover:text-warm-700",
              )}
            >
              <SlidersHorizontal className="h-[18px] w-[18px]" />
              <span className="hidden sm:inline">Filters</span>
              {advancedCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber px-1 text-[11px] font-bold text-white">
                  {advancedCount}
                </span>
              )}
            </button>
          </div>

          <div className="mt-2.5 flex items-center gap-2 sm:hidden">
            <MonthNavigator
              filters={filters}
              onNavigate={navigateMonth}
              onOpenPicker={openMonthDialog}
              className="flex min-w-0 flex-1"
            />
            <TypeToggle filters={filters} onChange={update} compact className="flex" />
          </div>

          <div className="mt-2.5 hidden items-center justify-end sm:flex lg:hidden">
            <TypeToggle filters={filters} onChange={update} className="flex" />
          </div>

          <div className="mt-2.5 flex min-w-0 items-center gap-2 border-t border-cream-100 pt-2.5">
            <ResultCount totalCount={totalCount} />

            {activeChips.length > 0 && (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {activeChips.map((chip) => (
                    <span key={chip.id} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-amber-light/35 pl-3 text-xs font-medium text-amber-dark">
                      {chip.label}
                      <button type="button" onClick={chip.onRemove} aria-label={`Remove ${chip.label} filter`} className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors hover:bg-amber/15">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>

                {hasActiveFilters(filters) && (
                  <button type="button" onClick={clearAll} className="ml-auto min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-warm-400 transition-colors hover:bg-cream-100 hover:text-warm-700">
                    Clear all
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <TransactionFilterDialog open={filterDialogOpen} onClose={() => setFilterDialogOpen(false)} filters={filters} options={filterOptions} currencySymbol={currencySymbol} onApply={applyAdvancedFilters} />
      <TransactionMonthDialog open={monthDialogOpen} onClose={() => setMonthDialogOpen(false)} year={monthPickerYear} onYearChange={setMonthPickerYear} selectedMonth={filters.month} currentMonth={accountMonthKey(new Date(), user.timezoneOffset)} onSelect={selectMonth} />
    </>
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
