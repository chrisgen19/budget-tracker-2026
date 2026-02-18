"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { categorySchema, type CategoryInput } from "@/lib/validations";
import { CategoryIcon, AVAILABLE_ICONS } from "@/components/ui/icon-map";
import type { Category } from "@/types";

const PRESET_COLORS = [
  "#E07C4F", "#5B8DEF", "#8B6FC0", "#F5A623", "#E05B8D",
  "#4ECDC4", "#FF6B6B", "#45B7D1", "#C8702A", "#2D8B5A",
  "#8B7E6A", "#6366F1", "#EC4899", "#14B8A6", "#F59E0B",
];

interface CategoryFormProps {
  category?: Category | null;
  onSubmit: (data: CategoryInput) => Promise<void>;
  onCancel: () => void;
}

export function CategoryForm({ category, onSubmit, onCancel }: CategoryFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CategoryInput>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name ?? "",
      type: category?.type ?? "EXPENSE",
      icon: category?.icon ?? "MoreHorizontal",
      color: category?.color ?? PRESET_COLORS[0],
    },
  });

  const selectedType = watch("type");
  const selectedIcon = watch("icon");
  const selectedColor = watch("color");

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

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-warm-600 mb-1.5">
          Category Name
        </label>
        <input
          type="text"
          {...register("name")}
          className="w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
          placeholder="e.g. Groceries"
        />
        {errors.name && (
          <p className="text-expense text-sm mt-1">{errors.name.message}</p>
        )}
      </div>

      {/* Color Picker */}
      <div>
        <label className="block text-sm font-medium text-warm-600 mb-2">
          Color
        </label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setValue("color", color)}
              className={`w-8 h-8 rounded-lg transition-all duration-150 ${
                selectedColor === color
                  ? "ring-2 ring-offset-2 ring-warm-400 scale-110"
                  : "hover:scale-105"
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
          {/* Custom color input */}
          <label className="w-8 h-8 rounded-lg border-2 border-dashed border-cream-300 flex items-center justify-center cursor-pointer hover:border-warm-400 transition-colors overflow-hidden relative">
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => setValue("color", e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <span className="text-warm-300 text-xs font-bold">+</span>
          </label>
        </div>
        {errors.color && (
          <p className="text-expense text-sm mt-1">{errors.color.message}</p>
        )}
      </div>

      {/* Icon Picker */}
      <div>
        <label className="block text-sm font-medium text-warm-600 mb-2">
          Icon
        </label>
        <div className="grid grid-cols-5 gap-2 max-h-40 overflow-y-auto">
          {AVAILABLE_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => setValue("icon", icon)}
              className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all duration-150 ${
                selectedIcon === icon
                  ? "border-amber bg-amber-light/50"
                  : "border-cream-200 hover:border-cream-400"
              }`}
            >
              <CategoryIcon
                name={icon}
                className="w-5 h-5"
                style={{ color: selectedColor }}
              />
            </button>
          ))}
        </div>
        <input type="hidden" {...register("icon")} />
        {errors.icon && (
          <p className="text-expense text-sm mt-1">{errors.icon.message}</p>
        )}
      </div>

      {/* Preview */}
      <div className="bg-cream-50 rounded-xl p-4 flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: selectedColor + "18" }}
        >
          <CategoryIcon
            name={selectedIcon}
            className="w-5 h-5"
            style={{ color: selectedColor }}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-warm-600">
            {watch("name") || "Category Preview"}
          </p>
          <p className="text-xs text-warm-400">
            {selectedType === "INCOME" ? "Income" : "Expense"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
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
          ) : category ? (
            "Update"
          ) : (
            "Create Category"
          )}
        </button>
      </div>
    </form>
  );
}
