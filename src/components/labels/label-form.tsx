"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Plus, X } from "lucide-react";
import { labelSchema, type LabelInput } from "@/lib/validations";
import { cn } from "@/lib/utils";
import type { Label } from "@/types";

const PRESET_COLORS = [
  "#E07C4F", "#5B8DEF", "#8B6FC0", "#F5A623", "#E05B8D",
  "#4ECDC4", "#FF6B6B", "#45B7D1", "#C8702A", "#2D8B5A",
  "#8B7E6A", "#6366F1", "#EC4899", "#14B8A6", "#F59E0B",
];

interface LabelFormProps {
  label?: Label | null;
  onSubmit: (data: LabelInput) => Promise<void>;
  onCancel: () => void;
}

export function LabelForm({ label, onSubmit, onCancel }: LabelFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LabelInput>({
    resolver: zodResolver(labelSchema),
    defaultValues: {
      name: label?.name ?? "",
      color: label?.color ?? PRESET_COLORS[0],
    },
  });

  const selectedColor = watch("color");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-warm-600 mb-1.5">
          Label Name
        </label>
        <input
          type="text"
          {...register("name")}
          className="w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
          placeholder="e.g. Vacation"
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
        <div className="flex flex-wrap gap-2.5">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setValue("color", color)}
              className={cn(
                "w-10 h-10 rounded-xl transition-all duration-150 flex items-center justify-center",
                selectedColor === color
                  ? "ring-2 ring-offset-2 ring-warm-400 scale-110"
                  : "hover:scale-105"
              )}
              style={{ backgroundColor: color }}
            >
              {selectedColor === color && (
                <Check className="w-4 h-4 text-white drop-shadow-sm" />
              )}
            </button>
          ))}
          {/* Custom color input */}
          <label className="w-10 h-10 rounded-xl border-2 border-dashed border-cream-300 flex items-center justify-center cursor-pointer hover:border-warm-400 transition-colors overflow-hidden relative">
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => setValue("color", e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <Plus className="w-4 h-4 text-warm-300" />
          </label>
        </div>
        {errors.color && (
          <p className="text-expense text-sm mt-1">{errors.color.message}</p>
        )}
      </div>

      {/* Preview */}
      <div>
        <label className="block text-sm font-medium text-warm-600 mb-2">
          Preview
        </label>
        <div className="bg-cream-50 rounded-xl p-4 flex items-center gap-3 border border-cream-200/60">
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
            style={{
              backgroundColor: selectedColor + "18",
              color: selectedColor,
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: selectedColor }}
            />
            {watch("name") || "Label Name"}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : label ? (
            "Update"
          ) : (
            <>
              <Plus className="w-4 h-4" />
              Create Label
            </>
          )}
        </button>
      </div>
    </form>
  );
}
