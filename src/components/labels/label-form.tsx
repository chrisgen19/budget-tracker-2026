"use client";

import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Plus, Trash2, X } from "lucide-react";
import { labelSchema, type LabelInput } from "@/lib/validations";
import { cn } from "@/lib/utils";
import type { LabelWithCountAndSchedules } from "@/types";

const PRESET_COLORS = [
  "#E07C4F", "#5B8DEF", "#8B6FC0", "#F5A623", "#E05B8D",
  "#4ECDC4", "#FF6B6B", "#45B7D1", "#C8702A", "#2D8B5A",
  "#8B7E6A", "#6366F1", "#EC4899", "#14B8A6", "#F59E0B",
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

interface LabelFormProps {
  label?: LabelWithCountAndSchedules | null;
  onSubmit: (data: LabelInput) => Promise<void>;
  onCancel: () => void;
}

export function LabelForm({ label, onSubmit, onCancel }: LabelFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<LabelInput>({
    resolver: zodResolver(labelSchema),
    defaultValues: {
      name: label?.name ?? "",
      color: label?.color ?? PRESET_COLORS[0],
      schedules: label?.schedules?.map((s) => ({
        id: s.id,
        days: s.days,
        startTime: s.startTime,
        endTime: s.endTime,
      })) ?? [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "schedules",
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

      {/* Schedules */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-warm-400" />
          <p className="text-sm font-medium text-warm-600">
            Auto-apply Schedule
          </p>
          <span className="text-xs text-warm-300">(Optional)</span>
        </div>

        <AnimatePresence mode="popLayout">
          {fields.map((field, index) => (
            <motion.div
              key={field.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mb-3"
            >
              <div className="rounded-xl border border-cream-200 bg-cream-50/30 p-3 space-y-3">
                {/* Day toggles */}
                <div>
                  <p className="text-xs text-warm-400 mb-2">Days</p>
                  <div className="flex gap-1.5">
                    {DAY_LABELS.map((dayLabel, dayIndex) => {
                      const currentDays: number[] = watch(`schedules.${index}.days`) ?? [];
                      const isActive = currentDays.includes(dayIndex);
                      return (
                        <button
                          key={dayIndex}
                          type="button"
                          aria-label={DAY_NAMES[dayIndex]}
                          aria-pressed={isActive}
                          onClick={() => {
                            const updated = isActive
                              ? currentDays.filter((d) => d !== dayIndex)
                              : [...currentDays, dayIndex].sort();
                            setValue(`schedules.${index}.days`, updated, { shouldValidate: true });
                          }}
                          className={cn(
                            "w-9 h-9 rounded-lg text-xs font-medium transition-all duration-150",
                            isActive
                              ? "bg-amber text-white shadow-soft"
                              : "bg-cream-100 text-warm-400 hover:bg-cream-200"
                          )}
                        >
                          {dayLabel}
                        </button>
                      );
                    })}
                  </div>
                  {errors.schedules?.[index]?.days && (
                    <p className="text-expense text-xs mt-1">
                      {errors.schedules[index].days?.message}
                    </p>
                  )}
                </div>

                {/* Time range */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-xs text-warm-400 mb-1">From</p>
                    <input
                      type="time"
                      {...register(`schedules.${index}.startTime`)}
                      className="w-full px-3 py-2 rounded-lg border border-cream-300 bg-white text-warm-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                    />
                  </div>
                  <span className="text-warm-300 text-sm mt-5">to</span>
                  <div className="flex-1">
                    <p className="text-xs text-warm-400 mb-1">To</p>
                    <input
                      type="time"
                      {...register(`schedules.${index}.endTime`)}
                      className="w-full px-3 py-2 rounded-lg border border-cream-300 bg-white text-warm-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="mt-5 p-2 rounded-lg text-warm-300 hover:text-expense hover:bg-expense-light transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {errors.schedules?.[index]?.endTime && (
                  <p className="text-expense text-xs">
                    {errors.schedules[index].endTime?.message}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => append({ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" })}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border-2 border-dashed border-cream-300 text-warm-400 hover:border-warm-400 hover:text-warm-500 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add Schedule
        </button>

        <p className="text-[11px] text-warm-300 mt-2">
          Transactions within these time windows will be auto-tagged with this label.
          End time is exclusive (e.g. 17:00 means up to but not including 5:00 PM).
          Overnight ranges (e.g. 22:00–06:00) are not supported — use two schedules instead.
        </p>
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
