"use client";

import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, CalendarDays, ChevronRight, Plus, Trash2 } from "lucide-react";
import { transactionSchema, type TransactionInput } from "@/lib/validations";
import { formatDateInput, getCurrencySymbol, cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { useUser } from "@/components/user-provider";
import type { Category, TransactionWithCategory } from "@/types";

interface TransactionFormProps {
  transaction?: TransactionWithCategory | null;
  onSubmit: (data: TransactionInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}

const formatAmountDisplay = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

type DateMode = "today" | "yesterday" | "custom";

/** Determine if a date string matches today or yesterday */
const getDateMode = (dateStr: string): DateMode => {
  const d = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "today";
  if (d.toDateString() === yesterday.toDateString()) return "yesterday";
  return "custom";
};

const slideVariants = {
  enterFromRight: { x: 80, opacity: 0 },
  enterFromLeft: { x: -80, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exitToLeft: { x: -80, opacity: 0 },
  exitToRight: { x: 80, opacity: 0 },
};

const QUICK_CATEGORY_COUNT = 4;

interface QuickPrefs {
  quickExpenseCategories: string[];
  quickIncomeCategories: string[];
}

export function TransactionForm({ transaction, onSubmit, onCancel, onDelete }: TransactionFormProps) {
  const { user } = useUser();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [quickPrefs, setQuickPrefs] = useState<QuickPrefs | null>(null);
  const [displayAmount, setDisplayAmount] = useState<string>(() =>
    transaction?.amount != null ? formatAmountDisplay(transaction.amount) : ""
  );
  const [dateMode, setDateMode] = useState<DateMode>(() =>
    transaction ? getDateMode(formatDateInput(transaction.date)) : "today"
  );
  const dateInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TransactionInput>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      type: transaction?.type ?? "EXPENSE",
      amount: transaction?.amount ?? undefined,
      description: transaction?.description ?? "",
      date: transaction ? formatDateInput(transaction.date) : formatDateInput(new Date()),
      categoryId: transaction?.categoryId ?? "",
    },
  });

  const selectedType = watch("type");
  const watchedCategoryId = watch("categoryId");
  const watchedDate = watch("date");
  const selectedCategory = categories.find((c) => c.id === watchedCategoryId);

  // Resolve personalized quick categories from prefs
  const quickCategories = (() => {
    if (!quickPrefs) return categories.slice(0, QUICK_CATEGORY_COUNT);
    const prefIds = selectedType === "EXPENSE"
      ? quickPrefs.quickExpenseCategories
      : quickPrefs.quickIncomeCategories;
    if (prefIds.length === 0) return categories.slice(0, QUICK_CATEGORY_COUNT);
    const resolved = prefIds
      .map((id) => categories.find((c) => c.id === id))
      .filter((c): c is Category => c != null);
    return resolved.length > 0 ? resolved : categories.slice(0, QUICK_CATEGORY_COUNT);
  })();

  const isSelectedInQuick = quickCategories.some((c) => c.id === watchedCategoryId);

  // Fetch quick category preferences once
  useEffect(() => {
    const fetchPrefs = async () => {
      const res = await fetch("/api/preferences");
      const data = await res.json();
      setQuickPrefs({
        quickExpenseCategories: data.quickExpenseCategories ?? [],
        quickIncomeCategories: data.quickIncomeCategories ?? [],
      });
    };
    fetchPrefs();
  }, []);

  useEffect(() => {
    const fetchCategories = async () => {
      setLoadingCategories(true);
      const res = await fetch(`/api/categories?type=${selectedType}`);
      const data = await res.json();
      setCategories(data);
      setLoadingCategories(false);

      // Reset category when type changes (unless editing)
      if (!transaction) {
        setValue("categoryId", "");
      }
    };
    fetchCategories();
  }, [selectedType, setValue, transaction]);

  const setDateToToday = () => {
    setDateMode("today");
    setValue("date", formatDateInput(new Date()));
  };

  const setDateToYesterday = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    setDateMode("yesterday");
    setValue("date", formatDateInput(yesterday));
  };

  const handleCustomDate = () => {
    setDateMode("custom");
    // Try to open native date picker after render
    setTimeout(() => dateInputRef.current?.showPicker?.(), 50);
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {showCategoryPicker ? (
        <motion.div
          key="category-picker"
          variants={slideVariants}
          initial="enterFromRight"
          animate="center"
          exit="exitToRight"
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <button
              type="button"
              onClick={() => setShowCategoryPicker(false)}
              className="p-2 -ml-2 rounded-xl text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h3 className="font-serif text-lg text-warm-700">Select Category</h3>
          </div>

          {/* Full Category Grid */}
          {loadingCategories ? (
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-20 rounded-xl animate-shimmer" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setValue("categoryId", cat.id, { shouldValidate: true });
                    setShowCategoryPicker(false);
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all duration-150",
                    watchedCategoryId === cat.id
                      ? "border-amber bg-amber-light/50"
                      : "border-cream-200 hover:border-cream-400"
                  )}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: cat.color + "18" }}
                  >
                    <CategoryIcon
                      name={cat.icon}
                      className="w-5 h-5"
                      style={{ color: cat.color }}
                    />
                  </div>
                  <span className="text-xs text-warm-600 text-center leading-tight truncate w-full">
                    {cat.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="transaction-form"
          variants={slideVariants}
          initial="enterFromLeft"
          animate="center"
          exit="exitToLeft"
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <form
            onSubmit={handleSubmit((data) =>
              onSubmit({ ...data, date: new Date(data.date).toISOString() })
            )}
            className="space-y-6"
          >
            {/* Type Toggle */}
            <div className="flex gap-1 p-1 bg-cream-100 rounded-xl">
              <button
                type="button"
                onClick={() => setValue("type", "EXPENSE")}
                className={cn(
                  "flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  selectedType === "EXPENSE"
                    ? "bg-white text-expense shadow-warm"
                    : "text-warm-400 hover:text-warm-600"
                )}
              >
                Expense
              </button>
              <button
                type="button"
                onClick={() => setValue("type", "INCOME")}
                className={cn(
                  "flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  selectedType === "INCOME"
                    ? "bg-white text-income shadow-warm"
                    : "text-warm-400 hover:text-warm-600"
                )}
              >
                Income
              </button>
            </div>

            {/* Amount — hero centerpiece */}
            <div className="text-center py-4">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-warm-300 uppercase mb-3">
                Amount
              </p>
              <div className="flex items-baseline justify-center gap-2">
                <span
                  className={cn(
                    "font-display font-semibold select-none transition-colors duration-200",
                    selectedType === "INCOME" ? "text-income/60" : "text-expense/60"
                  )}
                  style={{ fontSize: "30px", lineHeight: 1 }}
                >
                  {getCurrencySymbol(user.currency)}
                </span>
                <input type="hidden" {...register("amount", { valueAsNumber: true })} />
                <input
                  type="text"
                  inputMode="decimal"
                  value={displayAmount}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                    const parts = raw.split(".");
                    if (parts.length > 2) return;
                    if (parts[1]?.length > 2) return;
                    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                    const formatted = parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
                    setDisplayAmount(formatted);
                    const numeric = parseFloat(raw);
                    setValue(
                      "amount",
                      isNaN(numeric) ? (undefined as unknown as number) : numeric,
                      { shouldValidate: true }
                    );
                  }}
                  onBlur={() => {
                    if (!displayAmount) return;
                    const numeric = parseFloat(displayAmount.replace(/,/g, ""));
                    if (!isNaN(numeric)) {
                      setDisplayAmount(formatAmountDisplay(numeric));
                      setValue("amount", numeric, { shouldValidate: true });
                    }
                  }}
                  style={{ fontSize: "48px", lineHeight: 1 }}
                  className={cn(
                    "bg-transparent border-none outline-none text-center tabular-nums font-display font-bold placeholder:text-warm-200/60 w-full max-w-[280px] transition-colors duration-200",
                    selectedType === "INCOME"
                      ? "text-income caret-income"
                      : "text-expense caret-expense"
                  )}
                  placeholder="0.00"
                  autoFocus={!transaction}
                />
              </div>
              {errors.amount && (
                <p className="text-expense text-sm mt-2">{errors.amount.message}</p>
              )}
            </div>

            {/* Category — quick picks */}
            <div>
              <p className="text-sm font-semibold text-warm-600 mb-3">Category</p>

              {loadingCategories ? (
                <div className="grid grid-cols-4 gap-2.5">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-[88px] rounded-2xl animate-shimmer" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Quick category tiles */}
                  <div className="grid grid-cols-4 gap-2.5">
                    {quickCategories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() =>
                          setValue("categoryId", cat.id, { shouldValidate: true })
                        }
                        className={cn(
                          "flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-150",
                          watchedCategoryId === cat.id
                            ? "bg-amber-light ring-2 ring-amber/40"
                            : "bg-cream-100 hover:bg-cream-200/60"
                        )}
                      >
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-warm">
                          <CategoryIcon
                            name={cat.icon}
                            className="w-5 h-5"
                            style={{ color: cat.color }}
                          />
                        </div>
                        <span className="text-[11px] text-warm-500 text-center leading-tight truncate w-full">
                          {cat.name}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Selected category indicator (when picked from "More" and not in quick 4) */}
                  {selectedCategory && !isSelectedInQuick && (
                    <div className="flex items-center gap-2.5 mt-2.5 px-3 py-2 rounded-xl bg-amber-light/40 border border-amber/20">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: selectedCategory.color + "18" }}
                      >
                        <CategoryIcon
                          name={selectedCategory.icon}
                          className="w-3.5 h-3.5"
                          style={{ color: selectedCategory.color }}
                        />
                      </div>
                      <span className="text-xs font-medium text-warm-600 truncate">
                        {selectedCategory.name}
                      </span>
                    </div>
                  )}

                  {/* More categories button */}
                  {categories.length > QUICK_CATEGORY_COUNT && (
                    <button
                      type="button"
                      onClick={() => setShowCategoryPicker(true)}
                      className="w-full flex items-center justify-between px-4 py-3 mt-2.5 rounded-xl border border-cream-200 text-sm text-warm-400 hover:text-warm-600 hover:border-cream-300 transition-colors"
                    >
                      More categories...
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}

              {errors.categoryId && (
                <p className="text-expense text-sm mt-1.5">{errors.categoryId.message}</p>
              )}
            </div>

            {/* Date — quick picks */}
            <div>
              <p className="text-sm font-semibold text-warm-600 mb-3">Date</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={setDateToToday}
                  className={cn(
                    "flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                    dateMode === "today"
                      ? "bg-warm-800 text-white shadow-warm"
                      : "bg-cream-100 text-warm-500 hover:bg-cream-200/60"
                  )}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={setDateToYesterday}
                  className={cn(
                    "flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                    dateMode === "yesterday"
                      ? "bg-warm-800 text-white shadow-warm"
                      : "bg-cream-100 text-warm-500 hover:bg-cream-200/60"
                  )}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  onClick={handleCustomDate}
                  className={cn(
                    "w-11 shrink-0 flex items-center justify-center rounded-xl transition-all duration-150",
                    dateMode === "custom"
                      ? "bg-warm-800 text-white shadow-warm"
                      : "bg-cream-100 text-warm-400 hover:bg-cream-200/60"
                  )}
                >
                  <CalendarDays className="w-4 h-4" />
                </button>
              </div>

              {/* Custom date input — visible only in "custom" mode */}
              {dateMode === "custom" && (
                <input
                  ref={dateInputRef}
                  type="datetime-local"
                  value={watchedDate}
                  onChange={(e) => setValue("date", e.target.value)}
                  className="w-full mt-2.5 px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all appearance-none [&::-webkit-calendar-picker-indicator]:opacity-60"
                />
              )}

              {errors.date && (
                <p className="text-expense text-sm mt-1.5">{errors.date.message}</p>
              )}
            </div>

            {/* Note (Optional) */}
            <div>
              <p className="text-sm font-semibold text-warm-600 mb-2">
                Note{" "}
                <span className="font-normal text-warm-300">(Optional)</span>
              </p>
              <input
                type="text"
                {...register("description")}
                className="w-full px-4 py-3 rounded-xl border border-cream-200 bg-cream-50/50 text-warm-700 text-sm placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                placeholder="What was this for?"
              />
              {errors.description && (
                <p className="text-expense text-sm mt-1">{errors.description.message}</p>
              )}
            </div>

            {/* Action Buttons — sticky footer */}
            <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-4 bg-white border-t border-cream-200/60">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className={cn(
                    "inline-flex items-center justify-center py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors",
                    onDelete ? "w-1/4" : "w-1/3"
                  )}
                >
                  Cancel
                </button>
                {onDelete && (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="inline-flex items-center justify-center w-12 shrink-0 py-3 rounded-xl border border-expense/30 text-expense hover:bg-expense-light transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : transaction ? (
                    "Update"
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add Transaction
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
