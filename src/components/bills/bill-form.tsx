"use client";

import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, CalendarDays, ChevronRight, Plus } from "lucide-react";
import { scheduledTransactionSchema, type ScheduledTransactionInput } from "@/lib/validations";
import { formatDateInput, getCurrencySymbol, cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { useUser } from "@/components/user-provider";
import { useCategoriesQuery, useQuickPreferencesQuery } from "@/hooks/use-categories";
import type { Category, ScheduledTransactionWithCategory } from "@/types";

interface BillFormProps {
  bill?: ScheduledTransactionWithCategory | null;
  onSubmit: (data: ScheduledTransactionInput) => Promise<void>;
  onCancel: () => void;
}

const formatAmountDisplay = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "ANNUALLY", label: "Annually" },
  { value: "CUSTOM", label: "Custom" },
] as const;

const REMINDER_OPTIONS = [
  { value: 0, label: "On the day" },
  { value: 1, label: "1 day" },
  { value: 2, label: "2 days" },
  { value: 3, label: "3 days" },
  { value: 7, label: "1 week" },
] as const;

const slideVariants = {
  enterFromRight: { x: 80, opacity: 0 },
  enterFromLeft: { x: -80, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exitToLeft: { x: -80, opacity: 0 },
  exitToRight: { x: 80, opacity: 0 },
};

const QUICK_CATEGORY_COUNT = 4;

export function BillForm({ bill, onSubmit, onCancel }: BillFormProps) {
  const { user } = useUser();
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showEndDate, setShowEndDate] = useState(!!bill?.endDate);
  const [displayAmount, setDisplayAmount] = useState<string>(() => {
    if (bill?.amount != null) return formatAmountDisplay(bill.amount);
    return "";
  });
  const initialCategoryApplied = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ScheduledTransactionInput>({
    resolver: zodResolver(scheduledTransactionSchema),
    defaultValues: {
      type: bill?.type ?? "EXPENSE",
      amount: bill?.amount ?? undefined,
      description: bill?.description ?? "",
      categoryId: bill?.categoryId ?? "",
      frequency: bill?.frequency ?? "MONTHLY",
      customIntervalDays: bill?.customIntervalDays ?? undefined,
      reminderDaysBefore: bill?.reminderDaysBefore ?? 0,
      startDate: bill
        ? formatDateInput(bill.startDate).slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      endDate: bill?.endDate
        ? formatDateInput(bill.endDate).slice(0, 10)
        : undefined,
    },
  });

  const selectedType = watch("type");
  const watchedCategoryId = watch("categoryId");
  const watchedFrequency = watch("frequency");

  // TanStack Query hooks
  const { data: categories = [], isLoading: loadingCategories } = useCategoriesQuery(selectedType);
  const { data: quickPrefs } = useQuickPreferencesQuery();

  const selectedCategory = categories.find((c) => c.id === watchedCategoryId);

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

  // Apply bill categoryId once after categories load
  useEffect(() => {
    if (categories.length === 0) return;

    if (bill?.categoryId && !initialCategoryApplied.current) {
      const match = categories.find((c) => c.id === bill.categoryId);
      if (match) {
        setValue("categoryId", match.id, { shouldValidate: true });
        initialCategoryApplied.current = true;
        return;
      }
    }

    if (!bill) {
      setValue("categoryId", "");
    }
  }, [categories, selectedType, setValue, bill]);

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
          key="bill-form"
          variants={slideVariants}
          initial="enterFromLeft"
          animate="center"
          exit="exitToLeft"
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <form
            onSubmit={handleSubmit(onSubmit)}
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
                  autoFocus={!bill}
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

            {/* Description */}
            <div>
              <p className="text-sm font-semibold text-warm-600 mb-2">
                Description{" "}
                <span className="font-normal text-warm-300">(Optional)</span>
              </p>
              <input
                type="text"
                {...register("description")}
                className="w-full px-4 py-3 rounded-xl border border-cream-200 bg-cream-50/50 text-warm-700 text-sm placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                placeholder="e.g. Netflix, Rent, Salary..."
              />
            </div>

            {/* Frequency */}
            <div>
              <p className="text-sm font-semibold text-warm-600 mb-3">Frequency</p>
              <div className="flex flex-wrap gap-2">
                {FREQUENCIES.map((freq) => (
                  <button
                    key={freq.value}
                    type="button"
                    onClick={() => setValue("frequency", freq.value)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150",
                      watchedFrequency === freq.value
                        ? "bg-warm-800 text-white shadow-warm"
                        : "bg-cream-100 text-warm-500 hover:bg-cream-200/60"
                    )}
                  >
                    {freq.label}
                  </button>
                ))}
              </div>

              {watchedFrequency === "CUSTOM" && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm text-warm-500">Every</span>
                  <input
                    type="number"
                    min={1}
                    {...register("customIntervalDays", { valueAsNumber: true })}
                    className="w-20 px-3 py-2 rounded-xl border border-cream-200 bg-cream-50/50 text-warm-700 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                    placeholder="14"
                  />
                  <span className="text-sm text-warm-500">days</span>
                </div>
              )}

              {errors.customIntervalDays && (
                <p className="text-expense text-sm mt-1.5">{errors.customIntervalDays.message}</p>
              )}
            </div>

            {/* Start Date */}
            <div>
              <p className="text-sm font-semibold text-warm-600 mb-2">Start Date</p>
              <div className="relative">
                <input
                  type="date"
                  {...register("startDate")}
                  className="w-full px-4 py-3 rounded-xl border border-cream-200 bg-cream-50/50 text-warm-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all appearance-none [&::-webkit-calendar-picker-indicator]:opacity-60"
                />
                <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-300 pointer-events-none" />
              </div>
              {errors.startDate && (
                <p className="text-expense text-sm mt-1.5">{errors.startDate.message}</p>
              )}
            </div>

            {/* End Date (optional) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-warm-600">
                  End Date{" "}
                  <span className="font-normal text-warm-300">(Optional)</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowEndDate(!showEndDate);
                    if (showEndDate) setValue("endDate", undefined);
                  }}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200",
                    showEndDate ? "bg-amber" : "bg-cream-300"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200",
                      showEndDate ? "translate-x-4" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>

              {showEndDate && (
                <div className="relative">
                  <input
                    type="date"
                    {...register("endDate")}
                    className="w-full px-4 py-3 rounded-xl border border-cream-200 bg-cream-50/50 text-warm-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all appearance-none [&::-webkit-calendar-picker-indicator]:opacity-60"
                  />
                  <CalendarDays className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-300 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Reminder */}
            <div>
              <p className="text-sm font-semibold text-warm-600 mb-3">Remind me</p>
              <div className="flex flex-wrap gap-2">
                {REMINDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setValue("reminderDaysBefore", opt.value)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150",
                      watch("reminderDaysBefore") === opt.value
                        ? "bg-warm-800 text-white shadow-warm"
                        : "bg-cream-100 text-warm-500 hover:bg-cream-200/60"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons — sticky footer */}
            <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-4 bg-white border-t border-cream-200/60">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-1/3 inline-flex items-center justify-center py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : bill ? (
                    "Update"
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add Bill
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
