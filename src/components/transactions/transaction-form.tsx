"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { transactionSchema, type TransactionInput } from "@/lib/validations";
import { formatDateInput } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import type { Category, TransactionWithCategory } from "@/types";

interface TransactionFormProps {
  transaction?: TransactionWithCategory | null;
  onSubmit: (data: TransactionInput) => Promise<void>;
  onCancel: () => void;
}

export function TransactionForm({ transaction, onSubmit, onCancel }: TransactionFormProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);

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
          <input
            type="number"
            step="0.01"
            {...register("amount", { valueAsNumber: true })}
            className="w-full pl-8 pr-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
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
          className="w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
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
          type="date"
          {...register("date")}
          className="w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
        />
        {errors.date && (
          <p className="text-expense text-sm mt-1">{errors.date.message}</p>
        )}
      </div>

      {/* Category */}
      <div>
        <label className="block text-sm font-medium text-warm-600 mb-1.5">
          Category
        </label>
        {loadingCategories ? (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl animate-shimmer" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {categories.map((cat) => (
              <label
                key={cat.id}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all duration-150 ${
                  watch("categoryId") === cat.id
                    ? "border-amber bg-amber-light/50"
                    : "border-cream-200 hover:border-cream-400"
                }`}
              >
                <input
                  type="radio"
                  value={cat.id}
                  {...register("categoryId")}
                  className="sr-only"
                />
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: cat.color + "18" }}
                >
                  <CategoryIcon
                    name={cat.icon}
                    className="w-4 h-4"
                    style={{ color: cat.color }}
                  />
                </div>
                <span className="text-[11px] text-warm-600 text-center leading-tight truncate w-full">
                  {cat.name}
                </span>
              </label>
            ))}
          </div>
        )}
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
  );
}
