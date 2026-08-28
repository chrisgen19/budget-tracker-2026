"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, ArrowLeft, CalendarDays, ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  resolveTransactionDate,
  transactionSchema,
  type TransactionInput,
} from "@/lib/validations";
import { getCurrencySymbol, cn } from "@/lib/utils";
import {
  formatAccountDateInput,
  relativeAccountDateInput,
} from "@/lib/account-time";
import { MAX_QUICK_CATEGORIES, resolveQuickCategories } from "@/lib/quick-categories";
import { CategoryIcon } from "@/components/ui/icon-map";
import { ReceiptBreakdown, toReceiptBreakdownMeta } from "@/components/transactions/receipt-breakdown";
import { useUser } from "@/components/user-provider";
import { useCategoriesQuery, useQuickPreferencesQuery } from "@/hooks/use-categories";
import { LabelPicker } from "@/components/transactions/label-picker";
import { useScheduledLabel } from "@/hooks/use-scheduled-label";
import { useLabelsQuery } from "@/hooks/use-labels";
import type { TransactionWithCategory } from "@/types";

export interface InitialTransactionData {
  amount?: number;
  description?: string;
  type?: "INCOME" | "EXPENSE";
  date?: string;
  categoryId?: string;
  labelIds?: string[];
}

interface TransactionFormProps {
  transaction?: TransactionWithCategory | null;
  initialData?: InitialTransactionData;
  /** When true, shows a warning that the receipt date year looks suspicious (possible POS error) */
  dateWarning?: boolean;
  /** Hide the label picker (e.g. in scan-review flows where labels aren't persisted) */
  hideLabelPicker?: boolean;
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

/** Determine if an account-local date string matches today or yesterday. */
const getDateMode = (dateStr: string, timezoneOffset: number): DateMode => {
  const day = dateStr.slice(0, 10);
  const now = new Date();
  if (day === formatAccountDateInput(now, timezoneOffset).slice(0, 10)) return "today";
  if (day === relativeAccountDateInput(now, timezoneOffset, -1).slice(0, 10)) {
    return "yesterday";
  }
  return "custom";
};

/** Draft inputs carry account wall time. Only explicitly zoned instants need conversion. */
const initialDateInput = (date: string, timezoneOffset: number): string =>
  /(?:Z|[+-]\d{2}:?\d{2})$/i.test(date)
    ? formatAccountDateInput(date, timezoneOffset)
    : date;

const slideVariants = {
  enterFromRight: { x: 80, opacity: 0 },
  enterFromLeft: { x: -80, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exitToLeft: { x: -80, opacity: 0 },
  exitToRight: { x: 80, opacity: 0 },
};


export function TransactionForm({ transaction, initialData, dateWarning, hideLabelPicker, onSubmit, onCancel, onDelete }: TransactionFormProps) {
  const { user } = useUser();
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [displayAmount, setDisplayAmount] = useState<string>(() => {
    if (transaction?.amount != null) return formatAmountDisplay(transaction.amount);
    if (initialData?.amount != null) return formatAmountDisplay(initialData.amount);
    return "";
  });
  const [dateMode, setDateMode] = useState<DateMode>(() => {
    if (transaction) {
      return getDateMode(
        formatAccountDateInput(transaction.date, user.timezoneOffset),
        user.timezoneOffset,
      );
    }
    if (initialData?.date) {
      return getDateMode(
        initialDateInput(initialData.date, user.timezoneOffset),
        user.timezoneOffset,
      );
    }
    return "today";
  });
  const dateInputRef = useRef<HTMLInputElement>(null);
  const initialCategoryApplied = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<TransactionInput>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      type: transaction?.type ?? initialData?.type ?? "EXPENSE",
      amount: transaction?.amount ?? initialData?.amount ?? undefined,
      description: transaction?.description ?? initialData?.description ?? "",
      date: transaction
        ? formatAccountDateInput(transaction.date, user.timezoneOffset)
        : initialData?.date
          ? initialDateInput(initialData.date, user.timezoneOffset)
          : formatAccountDateInput(new Date(), user.timezoneOffset),
      categoryId: transaction?.categoryId ?? initialData?.categoryId ?? "",
      labelIds: transaction?.labels?.map((tl) => tl.labelId) ?? initialData?.labelIds ?? [],
    },
  });

  const selectedType = watch("type");

  // Narrowed once rather than cast at the render site: the column only gained a write-side
  // schema in #119, so older rows may not match ReceiptBreakdownMeta.
  const receiptBreakdown = useMemo(
    () => toReceiptBreakdownMeta(transaction?.receiptBreakdown),
    [transaction?.receiptBreakdown]
  );
  const watchedCategoryId = watch("categoryId");
  const watchedDate = watch("date");
  const watchedLabelIds = watch("labelIds") ?? [];

  // Auto-label scheduling — only for new transactions; edits preserve user's label choices
  const isEditing = !!transaction;
  const { scheduledLabelId } = useScheduledLabel(
    isEditing ? undefined : resolveTransactionDate(watchedDate, user.timezoneOffset),
    selectedType,
  );
  const userRemovedAutoLabels = useRef<Set<string>>(new Set());
  const autoAppliedLabels = useRef<Set<string>>(new Set());
  const prevScheduledLabelId = useRef<string | null>(null);
  // Tracks whether the user interacted with labels at all (add, remove, toggle)
  const userTouchedLabels = useRef(false);
  // On edit, existing scheduled labels are treated as user-owned (no clock icon).
  // Clock icon only shows for labels auto-applied during the current editing session.
  const [autoAppliedSnapshot, setAutoAppliedSnapshot] = useState<string[]>([]);

  // TanStack Query hooks — cached across mounts
  const { data: allLabels = [] } = useLabelsQuery();
  const { data: categories = [], isLoading: loadingCategories } = useCategoriesQuery(selectedType);
  const { data: quickPrefs } = useQuickPreferencesQuery();

  const selectedCategory = categories.find((c) => c.id === watchedCategoryId);

  // Resolve personalized quick categories from prefs. Shared with the categories page so the tiles
  // shown here cannot disagree with the ones the picker there offers.
  const prefIds =
    selectedType === "EXPENSE"
      ? quickPrefs?.quickExpenseCategories
      : quickPrefs?.quickIncomeCategories;
  const quickCategories = resolveQuickCategories(prefIds ?? [], categories).display;

  const isSelectedInQuick = quickCategories.some((c) => c.id === watchedCategoryId);

  // Apply initialData categoryId once after categories load
  useEffect(() => {
    if (categories.length === 0) return;

    if (initialData?.categoryId && !initialCategoryApplied.current) {
      const match = categories.find((c) => c.id === initialData.categoryId);
      if (match) {
        setValue("categoryId", match.id, { shouldValidate: true });
        initialCategoryApplied.current = true;
        return;
      }
    }

    // Reset category when type changes (unless editing an existing transaction or applying initialData)
    if (!transaction && !initialData?.categoryId) {
      setValue("categoryId", "");
    }
  }, [categories, selectedType, setValue, transaction, initialData]);

  // Auto-apply or remove scheduled label when date changes
  useEffect(() => {
    if (hideLabelPicker) return;
    const prev = prevScheduledLabelId.current;
    prevScheduledLabelId.current = scheduledLabelId;

    // Read current label state imperatively to avoid stale closure issues
    const currentIds = getValues("labelIds") ?? [];

    // When the scheduled label changes, reset removal tracking for the new label
    if (scheduledLabelId !== prev && scheduledLabelId) {
      userRemovedAutoLabels.current.delete(scheduledLabelId);
    }

    let updatedIds = [...currentIds];

    // Remove previous auto-label only if WE auto-applied it (not user-owned)
    if (prev && prev !== scheduledLabelId && autoAppliedLabels.current.has(prev)) {
      updatedIds = updatedIds.filter((id) => id !== prev);
      autoAppliedLabels.current.delete(prev);
    }

    // Auto-add new scheduled label if not already present and not user-removed
    if (
      scheduledLabelId &&
      !updatedIds.includes(scheduledLabelId) &&
      !userRemovedAutoLabels.current.has(scheduledLabelId)
    ) {
      updatedIds = [...updatedIds, scheduledLabelId];
      autoAppliedLabels.current.add(scheduledLabelId);
    }

    // Only update if the array actually changed
    if (updatedIds.length !== currentIds.length || updatedIds.some((id, i) => id !== currentIds[i])) {
      setValue("labelIds", updatedIds);
    }

    // Sync snapshot for LabelPicker display
    setAutoAppliedSnapshot([...autoAppliedLabels.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledLabelId, hideLabelPicker]);

  // Strip incompatible labels when the transaction type changes
  useEffect(() => {
    if (hideLabelPicker || allLabels.length === 0) return;
    const currentIds = getValues("labelIds") ?? [];
    if (currentIds.length === 0) return;
    const compatible = currentIds.filter((id) => {
      const label = allLabels.find((l) => l.id === id);
      return !label || label.applicableTo === "BOTH" || label.applicableTo === selectedType;
    });
    if (compatible.length !== currentIds.length) {
      setValue("labelIds", compatible);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  const setDateToToday = () => {
    setDateMode("today");
    setValue("date", formatAccountDateInput(new Date(), user.timezoneOffset));
  };

  const setDateToYesterday = () => {
    setDateMode("yesterday");
    setValue("date", relativeAccountDateInput(new Date(), user.timezoneOffset, -1));
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
            onSubmit={handleSubmit((data) => {
              const { labelIds, ...rest } = data;
              const payload = {
                ...rest,
                date: resolveTransactionDate(data.date, user.timezoneOffset),
              };
              // Omit labelIds when:
              // - the picker is hidden (server should auto-apply), OR
              // - the picker is visible but the user never interacted with labels
              //   (labelIds is still the default [] and no auto-label was applied/removed)
              const userInteractedWithLabels = userTouchedLabels.current
                || userRemovedAutoLabels.current.size > 0
                || autoAppliedLabels.current.size > 0;
              const includeLabelIds = !hideLabelPicker && userInteractedWithLabels;
              return onSubmit(includeLabelIds ? { ...payload, labelIds } : payload);
            })}
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

            {/* Receipt Breakdown — only for itemized expenses. Narrowed rather than cast:
                rows written before the column had a write-side schema may not match. */}
            {selectedType === "EXPENSE" && receiptBreakdown && (
              <ReceiptBreakdown breakdown={receiptBreakdown} currency={user.currency} />
            )}

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
                  autoFocus={!transaction && user.transactionAmountAutofocus}
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
                  {categories.length > MAX_QUICK_CATEGORIES && (
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

            {/* Labels */}
            {!hideLabelPicker && (
              <LabelPicker
                selectedIds={watchedLabelIds}
                onChange={(ids) => {
                  userTouchedLabels.current = true;
                  if (scheduledLabelId) {
                    // User manually removed the auto-applied label
                    if (watchedLabelIds.includes(scheduledLabelId) && !ids.includes(scheduledLabelId)) {
                      userRemovedAutoLabels.current.add(scheduledLabelId);
                      autoAppliedLabels.current.delete(scheduledLabelId);
                    }
                    // User manually re-added the label — treat as user-owned, not auto
                    if (!watchedLabelIds.includes(scheduledLabelId) && ids.includes(scheduledLabelId)) {
                      autoAppliedLabels.current.delete(scheduledLabelId);
                      userRemovedAutoLabels.current.delete(scheduledLabelId);
                    }
                    setAutoAppliedSnapshot([...autoAppliedLabels.current]);
                  }
                  setValue("labelIds", ids);
                }}
                autoAppliedIds={autoAppliedSnapshot}
                transactionType={selectedType}
              />
            )}

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

              {dateWarning && dateMode !== "today" && dateMode !== "yesterday" && (
                <div className="flex items-start gap-2 mt-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    The receipt date year looks incorrect (possible POS error). Please verify the date is correct or tap <strong>Today</strong> to use today&apos;s date.
                  </p>
                </div>
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
