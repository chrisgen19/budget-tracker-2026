"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, getCurrencySymbol } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { useUser } from "@/components/user-provider";
import type { Category } from "@/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TransactionFilters {
  search: string;
  type: "ALL" | "INCOME" | "EXPENSE";
  month: string;
  categoryId: string | null;
  amountMin: number | null;
  amountMax: number | null;
  sortBy: "date" | "amount";
  sortDir: "asc" | "desc";
}

export interface TransactionFiltersBarProps {
  filters: TransactionFilters;
  onChange: (filters: TransactionFilters) => void;
  totalCount: number | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SORT_OPTIONS = [
  { label: "Date (newest)", sortBy: "date" as const, sortDir: "desc" as const },
  { label: "Date (oldest)", sortBy: "date" as const, sortDir: "asc" as const },
  { label: "Amount (high-low)", sortBy: "amount" as const, sortDir: "desc" as const },
  { label: "Amount (low-high)", sortBy: "amount" as const, sortDir: "asc" as const },
];

const DEFAULT_FILTERS: Omit<TransactionFilters, "month"> = {
  search: "",
  type: "ALL",
  categoryId: null,
  amountMin: null,
  amountMax: null,
  sortBy: "date",
  sortDir: "desc",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const getMonthLabel = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(year, m - 1)
  );
};

/** Count how many "advanced" filters are active (category, amount, sort) */
const countAdvancedFilters = (f: TransactionFilters): number => {
  let count = 0;
  if (f.categoryId) count++;
  if (f.amountMin !== null) count++;
  if (f.amountMax !== null) count++;
  if (f.sortBy !== "date" || f.sortDir !== "desc") count++;
  return count;
};

/** Check if any non-default filter is active (excluding month) */
const hasActiveFilters = (f: TransactionFilters): boolean =>
  f.search !== "" ||
  f.type !== "ALL" ||
  f.categoryId !== null ||
  f.amountMin !== null ||
  f.amountMax !== null ||
  f.sortBy !== "date" ||
  f.sortDir !== "desc";

/* ------------------------------------------------------------------ */
/*  Custom dropdown hook (click-outside + escape)                      */
/* ------------------------------------------------------------------ */

const useDropdown = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return { open, setOpen, ref };
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TransactionFiltersBar({
  filters,
  onChange,
  totalCount,
}: TransactionFiltersBarProps) {
  const { user } = useUser();
  const currencySymbol = getCurrencySymbol(user.currency);

  // Mobile expand state
  const [expanded, setExpanded] = useState(false);

  // Debounced search
  const [searchInput, setSearchInput] = useState(filters.search);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Categories for dropdown
  const [categories, setCategories] = useState<Category[]>([]);
  const categoryDropdown = useDropdown();
  const sortDropdown = useDropdown();

  // Amount input local state (strings for controlled inputs)
  const [amountMinInput, setAmountMinInput] = useState(
    filters.amountMin !== null ? String(filters.amountMin) : ""
  );
  const [amountMaxInput, setAmountMaxInput] = useState(
    filters.amountMax !== null ? String(filters.amountMax) : ""
  );
  const amountTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fetch categories when type changes
  useEffect(() => {
    const fetchCategories = async () => {
      const params = new URLSearchParams();
      if (filters.type !== "ALL") params.set("type", filters.type);
      const res = await fetch(`/api/categories?${params}`);
      if (res.ok) {
        const data: Category[] = await res.json();
        setCategories(data);
      }
    };
    fetchCategories();
  }, [filters.type]);

  // Reset category when type changes
  const prevTypeRef = useRef(filters.type);
  useEffect(() => {
    if (prevTypeRef.current !== filters.type) {
      prevTypeRef.current = filters.type;
      if (filters.categoryId) {
        onChange({ ...filters, categoryId: null });
      }
    }
  }, [filters, onChange]);

  // Sync search input when filters.search changes externally (e.g. clear all)
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  // Sync amount inputs when filters change externally
  useEffect(() => {
    setAmountMinInput(filters.amountMin !== null ? String(filters.amountMin) : "");
    setAmountMaxInput(filters.amountMax !== null ? String(filters.amountMax) : "");
  }, [filters.amountMin, filters.amountMax]);

  // Debounced search handler
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        onChange({ ...filters, search: value });
      }, 300);
    },
    [filters, onChange]
  );

  // Debounced amount handler
  const handleAmountChange = useCallback(
    (field: "amountMin" | "amountMax", value: string) => {
      if (field === "amountMin") setAmountMinInput(value);
      else setAmountMaxInput(value);

      if (amountTimerRef.current) clearTimeout(amountTimerRef.current);
      amountTimerRef.current = setTimeout(() => {
        const parsed = value === "" ? null : parseFloat(value);
        const numValue = parsed !== null && isNaN(parsed) ? null : parsed;
        onChange({ ...filters, [field]: numValue });
      }, 500);
    },
    [filters, onChange]
  );

  const update = (partial: Partial<TransactionFilters>) => {
    onChange({ ...filters, ...partial });
  };

  const navigateMonth = (direction: -1 | 1) => {
    const [year, m] = filters.month.split("-").map(Number);
    const d = new Date(year, m - 1 + direction, 1);
    update({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` });
  };

  const clearAll = () => {
    onChange({ ...filters, ...DEFAULT_FILTERS });
    setSearchInput("");
    setAmountMinInput("");
    setAmountMaxInput("");
  };

  const advancedCount = countAdvancedFilters(filters);
  const selectedCategory = filters.categoryId
    ? categories.find((c) => c.id === filters.categoryId)
    : null;

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.sortBy === filters.sortBy && o.sortDir === filters.sortDir)?.label ??
    "Date (newest)";

  /* ---- Active filter chips ---- */
  const activeChips: { label: string; onRemove: () => void }[] = [];

  if (filters.search) {
    activeChips.push({
      label: `"${filters.search}"`,
      onRemove: () => { update({ search: "" }); setSearchInput(""); },
    });
  }
  if (filters.type !== "ALL") {
    activeChips.push({
      label: filters.type === "INCOME" ? "Income" : "Expenses",
      onRemove: () => update({ type: "ALL" }),
    });
  }
  if (selectedCategory) {
    activeChips.push({
      label: selectedCategory.name,
      onRemove: () => update({ categoryId: null }),
    });
  }
  if (filters.amountMin !== null) {
    activeChips.push({
      label: `Min: ${currencySymbol}${filters.amountMin}`,
      onRemove: () => { update({ amountMin: null }); setAmountMinInput(""); },
    });
  }
  if (filters.amountMax !== null) {
    activeChips.push({
      label: `Max: ${currencySymbol}${filters.amountMax}`,
      onRemove: () => { update({ amountMax: null }); setAmountMaxInput(""); },
    });
  }
  if (filters.sortBy !== "date" || filters.sortDir !== "desc") {
    activeChips.push({
      label: currentSortLabel,
      onRemove: () => update({ sortBy: "date", sortDir: "desc" }),
    });
  }

  return (
    <div className="card mb-4 overflow-visible">
      <div className="p-3 space-y-3">
        {/* Row 1: Search + Type Toggle */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-300" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search transactions..."
              className="w-full pl-10 pr-9 py-2.5 rounded-lg border border-cream-200 bg-cream-50/50 text-sm text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/20 focus:border-amber transition-all"
            />
            {searchInput && (
              <button
                onClick={() => handleSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-warm-300 hover:text-warm-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Type Toggle */}
          <div className="flex gap-1 p-0.5 bg-cream-100 rounded-lg shrink-0">
            {(["ALL", "INCOME", "EXPENSE"] as const).map((type) => (
              <button
                key={type}
                onClick={() => update({ type })}
                className={cn(
                  "px-4 py-2 rounded-md text-xs font-medium transition-all duration-150",
                  filters.type === type
                    ? type === "INCOME"
                      ? "bg-income/10 text-income shadow-warm"
                      : type === "EXPENSE"
                        ? "bg-expense/10 text-expense shadow-warm"
                        : "bg-white text-warm-700 shadow-warm"
                    : "text-warm-400 hover:text-warm-600"
                )}
              >
                {type === "ALL" ? "All" : type === "INCOME" ? "Income" : "Expenses"}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Month Nav + Category + Sort + Clear (desktop) / Month + Filter Icon (mobile) */}
        <div className="flex items-center gap-2">
          {/* Month Navigator */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-2 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-warm-600 min-w-[110px] text-center select-none">
              {getMonthLabel(filters.month)}
            </span>
            <button
              onClick={() => navigateMonth(1)}
              className="p-2 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Desktop: Category Dropdown */}
          <div ref={categoryDropdown.ref} className="relative hidden sm:block">
            <button
              onClick={() => categoryDropdown.setOpen((o) => !o)}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors",
                filters.categoryId
                  ? "border-amber/40 bg-amber-light/10 text-warm-700"
                  : "border-cream-200 text-warm-500 hover:border-cream-300 hover:text-warm-600"
              )}
            >
              {selectedCategory ? (
                <>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: selectedCategory.color }}
                  />
                  <span className="max-w-[120px] truncate">{selectedCategory.name}</span>
                </>
              ) : (
                <span>Category</span>
              )}
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform duration-200",
                  categoryDropdown.open && "rotate-180"
                )}
              />
            </button>

            <AnimatePresence>
              {categoryDropdown.open && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 top-full mt-1 w-60 max-h-64 overflow-y-auto bg-white rounded-xl shadow-soft-lg border border-cream-300/60 z-50"
                >
                  {/* All categories option */}
                  <button
                    onClick={() => {
                      update({ categoryId: null });
                      categoryDropdown.setOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm transition-colors",
                      !filters.categoryId
                        ? "bg-cream-50 text-warm-700 font-medium"
                        : "text-warm-500 hover:bg-cream-50"
                    )}
                  >
                    All categories
                  </button>
                  <div className="h-px bg-cream-200" />
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        update({ categoryId: cat.id });
                        categoryDropdown.setOpen(false);
                      }}
                      className={cn(
                        "flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm transition-colors",
                        filters.categoryId === cat.id
                          ? "bg-cream-50 text-warm-700 font-medium"
                          : "text-warm-500 hover:bg-cream-50"
                      )}
                    >
                      <div
                        className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: cat.color + "18" }}
                      >
                        <CategoryIcon
                          name={cat.icon}
                          className="w-3.5 h-3.5"
                          style={{ color: cat.color }}
                        />
                      </div>
                      <span className="truncate">{cat.name}</span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0 ml-auto"
                        style={{ backgroundColor: cat.color }}
                      />
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop: Sort Dropdown */}
          <div ref={sortDropdown.ref} className="relative hidden sm:block">
            <button
              onClick={() => sortDropdown.setOpen((o) => !o)}
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors",
                filters.sortBy !== "date" || filters.sortDir !== "desc"
                  ? "border-amber/40 bg-amber-light/10 text-warm-700"
                  : "border-cream-200 text-warm-500 hover:border-cream-300 hover:text-warm-600"
              )}
            >
              <span>{currentSortLabel}</span>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform duration-200",
                  sortDropdown.open && "rotate-180"
                )}
              />
            </button>

            <AnimatePresence>
              {sortDropdown.open && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 top-full mt-1 w-48 bg-white rounded-xl shadow-soft-lg border border-cream-300/60 z-50"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => {
                        update({ sortBy: opt.sortBy, sortDir: opt.sortDir });
                        sortDropdown.setOpen(false);
                      }}
                      className={cn(
                        "flex items-center w-full px-4 py-2.5 text-left text-sm transition-colors",
                        filters.sortBy === opt.sortBy && filters.sortDir === opt.sortDir
                          ? "bg-cream-50 text-warm-700 font-medium"
                          : "text-warm-500 hover:bg-cream-50"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop: Amount Range */}
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-warm-300">
                {currencySymbol}
              </span>
              <input
                type="number"
                value={amountMinInput}
                onChange={(e) => handleAmountChange("amountMin", e.target.value)}
                placeholder="min"
                min="0"
                className="w-[90px] pl-7 pr-2 py-2 rounded-lg border border-cream-200 bg-cream-50/50 text-sm text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/20 focus:border-amber transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <span className="text-warm-300 text-xs">&mdash;</span>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-warm-300">
                {currencySymbol}
              </span>
              <input
                type="number"
                value={amountMaxInput}
                onChange={(e) => handleAmountChange("amountMax", e.target.value)}
                placeholder="max"
                min="0"
                className="w-[90px] pl-7 pr-2 py-2 rounded-lg border border-cream-200 bg-cream-50/50 text-sm text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/20 focus:border-amber transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          <div className="flex-1" />

          {/* Desktop: Clear all */}
          {hasActiveFilters(filters) && (
            <button
              onClick={clearAll}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear all
            </button>
          )}

          {/* Mobile: Filter toggle button */}
          <button
            onClick={() => setExpanded((o) => !o)}
            className={cn(
              "sm:hidden relative p-2 rounded-lg transition-colors",
              expanded || advancedCount > 0
                ? "bg-amber-light/20 text-amber-dark"
                : "text-warm-400 hover:text-warm-600 hover:bg-cream-100"
            )}
          >
            <SlidersHorizontal className="w-4.5 h-4.5" />
            {advancedCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4.5 h-4.5 rounded-full bg-amber text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {advancedCount}
              </span>
            )}
          </button>
        </div>

        {/* Active Filter Chips */}
        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeChips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-light/20 text-amber-dark text-xs font-medium"
              >
                {chip.label}
                <button
                  onClick={chip.onRemove}
                  className="p-0.5 rounded-full hover:bg-amber/20 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Mobile expanded filters */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="sm:hidden overflow-hidden"
            >
              <div className="pt-2 border-t border-cream-200 space-y-3">
                {/* Category */}
                <div>
                  <label className="block text-xs font-medium text-warm-400 mb-1.5">Category</label>
                  <div ref={categoryDropdown.ref} className="relative">
                    <button
                      onClick={() => categoryDropdown.setOpen((o) => !o)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors",
                        filters.categoryId
                          ? "border-amber/40 bg-amber-light/10 text-warm-700"
                          : "border-cream-200 text-warm-500"
                      )}
                    >
                      {selectedCategory ? (
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: selectedCategory.color }}
                          />
                          {selectedCategory.name}
                        </span>
                      ) : (
                        <span>All categories</span>
                      )}
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 transition-transform duration-200",
                          categoryDropdown.open && "rotate-180"
                        )}
                      />
                    </button>

                    <AnimatePresence>
                      {categoryDropdown.open && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto bg-white rounded-xl shadow-soft-lg border border-cream-300/60 z-50"
                        >
                          <button
                            onClick={() => {
                              update({ categoryId: null });
                              categoryDropdown.setOpen(false);
                            }}
                            className={cn(
                              "flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm transition-colors",
                              !filters.categoryId
                                ? "bg-cream-50 text-warm-700 font-medium"
                                : "text-warm-500 hover:bg-cream-50"
                            )}
                          >
                            All categories
                          </button>
                          <div className="h-px bg-cream-200" />
                          {categories.map((cat) => (
                            <button
                              key={cat.id}
                              onClick={() => {
                                update({ categoryId: cat.id });
                                categoryDropdown.setOpen(false);
                              }}
                              className={cn(
                                "flex items-center gap-3 w-full px-4 py-2.5 text-left text-sm transition-colors",
                                filters.categoryId === cat.id
                                  ? "bg-cream-50 text-warm-700 font-medium"
                                  : "text-warm-500 hover:bg-cream-50"
                              )}
                            >
                              <div
                                className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                                style={{ backgroundColor: cat.color + "18" }}
                              >
                                <CategoryIcon
                                  name={cat.icon}
                                  className="w-3.5 h-3.5"
                                  style={{ color: cat.color }}
                                />
                              </div>
                              <span className="truncate">{cat.name}</span>
                              <span
                                className="w-2 h-2 rounded-full shrink-0 ml-auto"
                                style={{ backgroundColor: cat.color }}
                              />
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Amount Range */}
                <div>
                  <label className="block text-xs font-medium text-warm-400 mb-1.5">Amount range</label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-warm-300">
                        {currencySymbol}
                      </span>
                      <input
                        type="number"
                        value={amountMinInput}
                        onChange={(e) => handleAmountChange("amountMin", e.target.value)}
                        placeholder="min"
                        min="0"
                        className="w-full pl-7 pr-2 py-2.5 rounded-lg border border-cream-200 bg-cream-50/50 text-sm text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/20 focus:border-amber transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <span className="text-warm-300 text-xs">&mdash;</span>
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-warm-300">
                        {currencySymbol}
                      </span>
                      <input
                        type="number"
                        value={amountMaxInput}
                        onChange={(e) => handleAmountChange("amountMax", e.target.value)}
                        placeholder="max"
                        min="0"
                        className="w-full pl-7 pr-2 py-2.5 rounded-lg border border-cream-200 bg-cream-50/50 text-sm text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/20 focus:border-amber transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Sort */}
                <div>
                  <label className="block text-xs font-medium text-warm-400 mb-1.5">Sort by</label>
                  <div ref={sortDropdown.ref} className="relative">
                    <button
                      onClick={() => sortDropdown.setOpen((o) => !o)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors",
                        filters.sortBy !== "date" || filters.sortDir !== "desc"
                          ? "border-amber/40 bg-amber-light/10 text-warm-700"
                          : "border-cream-200 text-warm-500"
                      )}
                    >
                      <span>{currentSortLabel}</span>
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 transition-transform duration-200",
                          sortDropdown.open && "rotate-180"
                        )}
                      />
                    </button>

                    <AnimatePresence>
                      {sortDropdown.open && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-soft-lg border border-cream-300/60 z-50"
                        >
                          {SORT_OPTIONS.map((opt) => (
                            <button
                              key={opt.label}
                              onClick={() => {
                                update({ sortBy: opt.sortBy, sortDir: opt.sortDir });
                                sortDropdown.setOpen(false);
                              }}
                              className={cn(
                                "flex items-center w-full px-4 py-2.5 text-left text-sm transition-colors",
                                filters.sortBy === opt.sortBy && filters.sortDir === opt.sortDir
                                  ? "bg-cream-50 text-warm-700 font-medium"
                                  : "text-warm-500 hover:bg-cream-50"
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Mobile: Clear all */}
                {hasActiveFilters(filters) && (
                  <button
                    onClick={clearAll}
                    className="w-full py-2.5 rounded-lg border border-cream-200 text-xs font-medium text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Result count bar */}
      {totalCount !== null && (
        <div className="px-3 py-2 border-t border-cream-100 bg-cream-50/50">
          <p className="text-xs text-warm-400">
            {totalCount} {totalCount === 1 ? "transaction" : "transactions"} found
          </p>
        </div>
      )}
    </div>
  );
}
