"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import type { Category } from "@/types";

const MAX_QUICK_CATEGORIES = 4;

interface QuickCategoryPickerProps {
  selectedIds: string[];
  allCategories: Category[];
  onSave: (ids: string[]) => void;
  onCancel: () => void;
  saving?: boolean;
}

export function QuickCategoryPicker({
  selectedIds: initialIds,
  allCategories,
  onSave,
  onCancel,
  saving = false,
}: QuickCategoryPickerProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const isFull = selectedIds.length >= MAX_QUICK_CATEGORIES;

  const toggleCategory = (id: string) => {
    setSelectedIds((prev) => {
      const index = prev.indexOf(id);
      if (index !== -1) {
        // Remove — shift others down
        return prev.filter((i) => i !== id);
      }
      if (prev.length >= MAX_QUICK_CATEGORIES) return prev;
      return [...prev, id];
    });
  };

  return (
    <div>
      <p className="text-sm text-warm-400 mb-4">
        Select up to {MAX_QUICK_CATEGORIES} categories. Tap to toggle.
      </p>

      <div className="grid grid-cols-3 gap-2 mb-6">
        {allCategories.map((cat) => {
          const order = selectedIds.indexOf(cat.id);
          const isSelected = order !== -1;
          const isDisabled = !isSelected && isFull;

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => toggleCategory(cat.id)}
              disabled={isDisabled}
              className={cn(
                "relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-150",
                isSelected
                  ? "border-amber bg-amber-light/50"
                  : isDisabled
                    ? "border-cream-200 opacity-40 cursor-not-allowed"
                    : "border-cream-200 hover:border-cream-400 cursor-pointer"
              )}
            >
              {/* Order badge */}
              {isSelected && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-amber text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
                  {order + 1}
                </span>
              )}

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
          );
        })}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(selectedIds)}
          disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50"
        >
          {saving ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <Check className="w-4 h-4" />
              Save
            </>
          )}
        </button>
      </div>
    </div>
  );
}
