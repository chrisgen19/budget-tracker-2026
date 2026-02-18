"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { transactionSchema, type TransactionInput } from "@/lib/validations";
import { formatDateInput } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import type { Category, TransactionWithCategory } from "@/types";

interface TransactionFormProps {
  transaction?: TransactionWithCategory | null;
  onSubmit: (data: TransactionInput) => Promise<void>;
  onCancel: () => void;
}

const formatAmountDisplay = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const slideVariants = {
  enterFromRight: { x: 80, opacity: 0 },
  enterFromLeft: { x: -80, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exitToLeft: { x: -80, opacity: 0 },
  exitToRight: { x: 80, opacity: 0 },
};

export function TransactionForm({ transaction, onSubmit, onCancel }: TransactionFormProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [displayAmount, setDisplayAmount] = useState<string>(() =>
    transaction?.amount != null ? formatAmountDisplay(transaction.amount) : ""
  );

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
  const selectedCategory = categories.find((c) => c.id === watchedCategoryId);

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

          {/* Category Grid */}
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
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all duration-150 ${
                    watchedCategoryId === cat.id
                      ? "border-amber bg-amber-light/50"
                      : "border-cream-200 hover:border-cream-400"
                  }`}
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
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Type Toggle */}
            <div className="flex gap-2 p-1 bg-cream-100 rounded-xl">
              <button
                type="button"
                onClick={() => setValue("type", "EXPENSE")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  selectedType === "EXPENSE"
                    ? "bg-white text-expense shadow-warm"
                    : "text-warm-400 hover:text-warm-600"
                }`}
              >
                Expense
              </button>
              <button
                type="button"
                onClick={() => setValue("type", "INCOME")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  selectedType === "INCOME"
                    ? "bg-white text-income shadow-warm"
                    : "text-warm-400 hover:text-warm-600"
                }`}
              >
                Income
              </button>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-1.5">
                Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-warm-400 text-sm">
                  ₱
                </span>
                <input type="hidden" {...register("amount", { valueAsNumber: true })} />
                <input
                  type="text"
                  inputMode="decimal"
                  value={displayAmount}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                    // Prevent multiple decimals or more than 2 decimal places
                    const parts = raw.split(".");
                    if (parts.length > 2) return;
                    if (parts[1]?.length > 2) return;
                    // Format integer part with commas
                    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                    const formatted = parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
                    setDisplayAmount(formatted);
                    const numeric = parseFloat(raw);
                    setValue("amount", isNaN(numeric) ? (undefined as unknown as number) : numeric, {
                      shouldValidate: true,
                    });
                  }}
                  onBlur={() => {
                    if (!displayAmount) return;
                    const numeric = parseFloat(displayAmount.replace(/,/g, ""));
                    if (!isNaN(numeric)) {
                      setDisplayAmount(formatAmountDisplay(numeric));
                      setValue("amount", numeric, { shouldValidate: true });
                    }
                  }}
                  className="w-full min-w-0 pl-8 pr-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                  placeholder="0.00"
                />
              </div>
              {errors.amount && (
                <p className="text-expense text-sm mt-1">{errors.amount.message}</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-1.5">
                Description
              </label>
              <input
                type="text"
                {...register("description")}
                className="w-full min-w-0 px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                placeholder="What was this for?"
              />
              {errors.description && (
                <p className="text-expense text-sm mt-1">{errors.description.message}</p>
              )}
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-1.5">
                Date
              </label>
              <input
                type="datetime-local"
                {...register("date")}
                className="w-full min-w-0 px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all appearance-none overflow-hidden [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-datetime-edit]:overflow-hidden [&::-webkit-datetime-edit-fields-wrapper]:overflow-hidden"
              />
              {errors.date && (
                <p className="text-expense text-sm mt-1">{errors.date.message}</p>
              )}
            </div>

            {/* Category Button */}
            <div>
              <label className="block text-sm font-medium text-warm-600 mb-1.5">
                Category
              </label>
              <button
                type="button"
                onClick={() => setShowCategoryPicker(true)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                  errors.categoryId
                    ? "border-expense/50 bg-expense/5"
                    : "border-cream-300 bg-cream-50/50 hover:border-cream-400"
                }`}
              >
                {selectedCategory ? (
                  <>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: selectedCategory.color + "18" }}
                    >
                      <CategoryIcon
                        name={selectedCategory.icon}
                        className="w-4 h-4"
                        style={{ color: selectedCategory.color }}
                      />
                    </div>
                    <span className="text-sm text-warm-700 font-medium flex-1 text-left">
                      {selectedCategory.name}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-warm-300 flex-1 text-left">
                    Select a category
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-warm-300 shrink-0" />
              </button>
              {errors.categoryId && (
                <p className="text-expense text-sm mt-1">{errors.categoryId.message}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-3 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 mx-auto border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : transaction ? (
                  "Update"
                ) : (
                  "Add Transaction"
                )}
              </button>
            </div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
