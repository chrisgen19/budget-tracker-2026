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
  ArrowUpDown,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useUser } from "@/components/user-provider";
import { useLabelsQuery } from "@/hooks/use-labels";
import { accountMonthKey } from "@/lib/account-time";
import { cn, getCurrencySymbol } from "@/lib/utils";
import type { Category, LabelWithCountAndSchedules } from "@/types";

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

const SOURCE_OPTIONS = [
  { value: "ALL" as const, label: "Any source" },
  { value: "APP" as const, label: "In app" },
  { value: "MCP" as const, label: "Claude" },
  { value: "TELEGRAM" as const, label: "Telegram" },
];

const SOURCE_CHIP_LABELS: Record<Exclude<TransactionFilters["createdVia"], "ALL">, string> = {
  APP: "Source: In app",
  MCP: "Source: Claude",
  TELEGRAM: "Source: Telegram",
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DESKTOP_QUERY = "(min-width: 640px)";
const EMPTY_LABELS: LabelWithCountAndSchedules[] = [];

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

const parseOptionalAmount = (value: string) => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function TransactionFiltersBar({
  filters,
  onChange,
  totalCount,
}: TransactionFiltersBarProps) {
  const { user } = useUser();
  const currencySymbol = getCurrencySymbol(user.currency);
  const labelsQuery = useLabelsQuery();
  const labels = labelsQuery.data ?? EMPTY_LABELS;
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [categoriesLoadSucceeded, setCategoriesLoadSucceeded] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [monthDialogOpen, setMonthDialogOpen] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(() =>
    Number(filters.month === "ALL" ? accountMonthKey(new Date(), user.timezoneOffset).slice(0, 4) : filters.month.slice(0, 4)),
  );
  const [draftFilters, setDraftFilters] = useState(filters);
  const [draftAmountMin, setDraftAmountMin] = useState("");
  const [draftAmountMax, setDraftAmountMax] = useState("");
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

  useEffect(() => {
    const controller = new AbortController();

    const fetchCategories = async () => {
      setCategoriesLoaded(false);
      setCategoriesLoadSucceeded(false);
      const params = new URLSearchParams();
      if (filters.type !== "ALL") params.set("type", filters.type);
      try {
        const response = await fetch(`/api/categories?${params}`, { signal: controller.signal });
        if (response.ok) {
          setCategories((await response.json()) as Category[]);
          setCategoriesLoadSucceeded(true);
        }
      } catch {
        // Keep the existing options on a transient failure. A selected value is
        // rendered explicitly below so the draft never disagrees with the UI.
      } finally {
        if (!controller.signal.aborted) setCategoriesLoaded(true);
      }
    };
    void fetchCategories();
    return () => controller.abort();
  }, [filters.type]);

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

  useEffect(() => {
    if (!filterDialogOpen) return;

    setDraftFilters((current) => {
      const categoryId =
        categoriesLoadSucceeded &&
        current.categoryId &&
        !categories.some((category) => category.id === current.categoryId)
          ? null
          : current.categoryId;
      const labelId =
        labelsQuery.isSuccess &&
        current.labelId &&
        !labels.some((label) => label.id === current.labelId)
          ? null
          : current.labelId;

      return categoryId === current.categoryId && labelId === current.labelId
        ? current
        : { ...current, categoryId, labelId };
    });
  }, [
    categories,
    categoriesLoadSucceeded,
    filterDialogOpen,
    labels,
    labelsQuery.isSuccess,
  ]);

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
    setDraftFilters(filters);
    setDraftAmountMin(filters.amountMin === null ? "" : String(filters.amountMin));
    setDraftAmountMax(filters.amountMax === null ? "" : String(filters.amountMax));
    setFilterDialogOpen(true);
  };

  const resetAdvancedDraft = () => {
    setDraftFilters((current) => ({
      ...current,
      categoryId: null,
      labelId: null,
      createdVia: "ALL",
      amountMin: null,
      amountMax: null,
      sortBy: "date",
      sortDir: "desc",
    }));
    setDraftAmountMin("");
    setDraftAmountMax("");
  };

  const parsedDraftMin = parseOptionalAmount(draftAmountMin);
  const parsedDraftMax = parseOptionalAmount(draftAmountMax);
  const amountRangeInvalid =
    parsedDraftMin !== null && parsedDraftMax !== null && parsedDraftMin > parsedDraftMax;
  const filterOptionsLoading =
    (!categoriesLoaded && draftFilters.categoryId !== null) ||
    (labelsQuery.isPending && draftFilters.labelId !== null);

  const applyAdvancedFilters = () => {
    if (amountRangeInvalid || filterOptionsLoading) return;
    onChange((current) => ({
      ...current,
      categoryId: draftFilters.categoryId,
      labelId: draftFilters.labelId,
      createdVia: draftFilters.createdVia,
      amountMin: parsedDraftMin,
      amountMax: parsedDraftMax,
      sortBy: draftFilters.sortBy,
      sortDir: draftFilters.sortDir,
    }));
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
                className="min-h-11 w-full rounded-xl border border-cream-200 bg-cream-50/60 py-2.5 pl-10 pr-10 text-sm text-warm-700 outline-none transition placeholder:text-warm-300 focus:border-amber focus:bg-white focus:ring-2 focus:ring-amber/20"
              />
              {searchInput && (
                <button type="button" onClick={() => handleSearchChange("")} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex min-h-8 min-w-8 -translate-y-1/2 items-center justify-center rounded-lg text-warm-300 transition-colors hover:bg-cream-100 hover:text-warm-600">
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
                  <span key={chip.id} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-amber-light/35 pl-2.5 pr-1 text-xs font-medium text-amber-dark">
                    {chip.label}
                    <button type="button" onClick={chip.onRemove} aria-label={`Remove ${chip.label} filter`} className="flex min-h-7 min-w-7 items-center justify-center rounded-full transition-colors hover:bg-amber/15">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>

              {hasActiveFilters(filters) && (
                <button type="button" onClick={clearAll} className="ml-auto shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-warm-400 transition-colors hover:bg-cream-100 hover:text-warm-700">
                  Clear all
                </button>
              )}
              </>
            )}
          </div>
        </div>
      </section>

      <Modal open={filterDialogOpen} onClose={() => setFilterDialogOpen(false)} title="Filter & sort">
        <div className="space-y-5">
          <p className="text-sm leading-6 text-warm-400">
            Narrow the list by category, label, amount, or where it was added.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-warm-400">Category</span>
              <select value={draftFilters.categoryId ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, categoryId: event.target.value || null }))} disabled={!categoriesLoaded} className="min-h-11 w-full rounded-xl border border-cream-200 bg-cream-50/60 px-3 text-sm text-warm-700 outline-none transition focus:border-amber focus:bg-white focus:ring-2 focus:ring-amber/20 disabled:cursor-wait disabled:text-warm-300">
                <option value="">{categoriesLoaded ? "All categories" : "Loading categories…"}</option>
                {draftFilters.categoryId && !categories.some((category) => category.id === draftFilters.categoryId) && (
                  <option value={draftFilters.categoryId}>
                    {categoriesLoaded ? "Selected category unavailable" : "Loading selected category…"}
                  </option>
                )}
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-warm-400">Label</span>
              <select value={draftFilters.labelId ?? ""} onChange={(event) => setDraftFilters((current) => ({ ...current, labelId: event.target.value || null }))} disabled={labelsQuery.isPending || (labels.length === 0 && !draftFilters.labelId)} className="min-h-11 w-full rounded-xl border border-cream-200 bg-cream-50/60 px-3 text-sm text-warm-700 outline-none transition focus:border-amber focus:bg-white focus:ring-2 focus:ring-amber/20 disabled:cursor-not-allowed disabled:text-warm-300">
                <option value="">{labelsQuery.isPending ? "Loading labels…" : labels.length === 0 ? "No labels yet" : "All labels"}</option>
                {draftFilters.labelId && !labels.some((label) => label.id === draftFilters.labelId) && (
                  <option value={draftFilters.labelId}>
                    {labelsQuery.isPending ? "Loading selected label…" : "Selected label unavailable"}
                  </option>
                )}
                {labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-warm-400">Amount range</legend>
            <div className="flex items-center gap-2">
              <AmountInput label="Minimum amount" value={draftAmountMin} onChange={setDraftAmountMin} placeholder="Minimum" currencySymbol={currencySymbol} />
              <span aria-hidden="true" className="text-warm-300">–</span>
              <AmountInput label="Maximum amount" value={draftAmountMax} onChange={setDraftAmountMax} placeholder="Maximum" currencySymbol={currencySymbol} invalid={amountRangeInvalid} describedBy={amountRangeInvalid ? "amount-range-error" : undefined} />
            </div>
            {amountRangeInvalid && (
              <p id="amount-range-error" className="mt-1.5 text-xs font-medium text-expense">
                Maximum amount must be greater than or equal to minimum amount.
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-400">Added via</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SOURCE_OPTIONS.map((option) => (
                <button key={option.value} type="button" onClick={() => setDraftFilters((current) => ({ ...current, createdVia: option.value }))} aria-pressed={draftFilters.createdVia === option.value} className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors", draftFilters.createdVia === option.value ? "border-amber/40 bg-amber-light/30 text-amber-dark" : "border-cream-200 text-warm-500 hover:bg-cream-50")}>
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warm-400">
              <ArrowUpDown className="h-3.5 w-3.5" /> Sort by
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {SORT_OPTIONS.map((option) => {
                const selected = draftFilters.sortBy === option.sortBy && draftFilters.sortDir === option.sortDir;
                return (
                  <button key={option.label} type="button" onClick={() => setDraftFilters((current) => ({ ...current, sortBy: option.sortBy, sortDir: option.sortDir }))} aria-pressed={selected} className={cn("min-h-11 rounded-xl border px-3 text-left text-sm font-medium transition-colors", selected ? "border-amber/40 bg-amber-light/30 text-amber-dark" : "border-cream-200 text-warm-500 hover:bg-cream-50")}>
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center gap-2 border-t border-cream-200 bg-white px-6 py-4">
            <button type="button" onClick={resetAdvancedDraft} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-warm-400 transition-colors hover:bg-cream-100 hover:text-warm-700">Reset</button>
            <button type="button" onClick={applyAdvancedFilters} disabled={amountRangeInvalid || filterOptionsLoading} className="min-h-11 flex-1 rounded-xl bg-amber px-5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-amber-dark disabled:cursor-not-allowed disabled:opacity-50">{filterOptionsLoading ? "Loading filters…" : "Apply filters"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={monthDialogOpen} onClose={() => setMonthDialogOpen(false)} title="Choose month">
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-xl bg-cream-50 p-1">
            <button type="button" onClick={() => setMonthPickerYear((year) => year - 1)} aria-label="Previous year" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-serif text-xl text-warm-700">{monthPickerYear}</span>
            <button type="button" onClick={() => setMonthPickerYear((year) => year + 1)} aria-label="Next year" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {MONTH_NAMES.map((monthName, index) => {
              const value = `${monthPickerYear}-${String(index + 1).padStart(2, "0")}`;
              const selected = filters.month === value;
              return (
                <button key={monthName} type="button" onClick={() => selectMonth(value)} aria-pressed={selected} className={cn("min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors", selected ? "border-amber bg-amber-light/35 text-amber-dark" : "border-cream-200 text-warm-500 hover:border-cream-300 hover:bg-cream-50 hover:text-warm-700")}>
                  {monthName.slice(0, 3)}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 border-t border-cream-200 pt-4">
            <button type="button" onClick={() => selectMonth("ALL")} className="min-h-11 flex-1 rounded-xl border border-cream-200 px-3 text-sm font-semibold text-warm-500 transition-colors hover:bg-cream-50 hover:text-warm-700">All time</button>
            <button type="button" onClick={() => selectMonth(accountMonthKey(new Date(), user.timezoneOffset))} className="min-h-11 flex-1 rounded-xl bg-amber px-3 text-sm font-semibold text-white transition-colors hover:bg-amber-dark">This month</button>
          </div>
        </div>
      </Modal>
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
      <button type="button" onClick={() => onNavigate(-1)} aria-label="Previous month" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button type="button" onClick={onOpenPicker} aria-label={`Choose month, ${getMonthLabel(filters.month)}`} aria-haspopup="dialog" className="relative flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-warm-600 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/20 sm:min-w-32">
        <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-warm-400" />
        <span className="min-w-0 select-none truncate text-center">
          {getMonthLabel(filters.month)}
        </span>
      </button>
      <button type="button" onClick={() => onNavigate(1)} aria-label="Next month" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700">
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
        <button key={type} type="button" onClick={() => onChange({ type })} aria-label={compact ? type === "ALL" ? "All transactions" : type.toLowerCase() : undefined} aria-pressed={filters.type === type} className={cn("min-h-9 rounded-lg text-xs font-semibold transition-colors", compact ? "min-w-9 px-2" : "px-3", filters.type === type ? type === "INCOME" ? "bg-white text-income shadow-warm" : type === "EXPENSE" ? "bg-white text-expense shadow-warm" : "bg-white text-warm-700 shadow-warm" : "text-warm-400 hover:text-warm-600")}>
          {compact ? type === "ALL" ? "All" : type === "INCOME" ? "+" : "−" : type === "ALL" ? "All" : type === "INCOME" ? "Income" : "Expenses"}
        </button>
      ))}
    </div>
  );
}

function AmountInput({
  label,
  value,
  onChange,
  placeholder,
  currencySymbol,
  invalid = false,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  currencySymbol: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <label className="relative min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-warm-300">{currencySymbol}</span>
      <input type="number" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} min="0" inputMode="decimal" aria-invalid={invalid} aria-describedby={describedBy} className="min-h-11 min-w-0 w-full rounded-xl border border-cream-200 bg-cream-50/60 py-2.5 pl-8 pr-3 text-sm text-warm-700 outline-none transition placeholder:text-warm-300 focus:border-amber focus:bg-white focus:ring-2 focus:ring-amber/20" />
    </label>
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
