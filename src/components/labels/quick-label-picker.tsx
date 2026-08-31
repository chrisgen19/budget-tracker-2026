"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_QUICK_LABELS } from "@/lib/quick-labels";
import type { LabelWithCountAndSchedules } from "@/types";

interface QuickLabelPickerProps {
  selectedIds: string[];
  allLabels: LabelWithCountAndSchedules[];
  onSave: (ids: string[]) => void;
  onCancel: () => void;
  saving?: boolean;
}

export function QuickLabelPicker({
  selectedIds: initialIds,
  allLabels,
  onSave,
  onCancel,
  saving = false,
}: QuickLabelPickerProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const isFull = selectedIds.length >= MAX_QUICK_LABELS;

  const toggleLabel = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((i) => i !== id);
      if (prev.length >= MAX_QUICK_LABELS) return prev;
      return [...prev, id];
    });
  };

  return (
    <div>
      <p className="text-sm text-warm-400 mb-4">
        Pin up to {MAX_QUICK_LABELS} labels for quick access. Pinned labels appear first when adding transactions.
      </p>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-warm-400">Select labels in display order</p>
        <p className="text-xs font-semibold text-warm-500" aria-live="polite">
          {selectedIds.length} of {MAX_QUICK_LABELS} selected
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {allLabels.map((lbl) => {
          const order = selectedIds.indexOf(lbl.id);
          const isSelected = order !== -1;
          const isDisabled = !isSelected && isFull;

          return (
            <button
              key={lbl.id}
              type="button"
              aria-pressed={isSelected}
              aria-label={lbl.name}
              onClick={() => toggleLabel(lbl.id)}
              disabled={isDisabled}
              className={cn(
                "relative inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium text-warm-600 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:ring-offset-2",
                !isSelected &&
                  (isDisabled
                    ? "cursor-not-allowed border-cream-200 opacity-40"
                    : "border-cream-300 bg-white hover:border-warm-300 hover:bg-cream-50"),
                isSelected && "border-amber/60 bg-amber-light/50 shadow-sm",
              )}
            >
              {isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber text-white text-[9px] font-bold flex items-center justify-center shadow-sm"
                >
                  {order + 1}
                </span>
              )}
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: lbl.color }}
              />
              {lbl.name}
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                  isSelected ? "bg-amber text-white" : "border border-cream-300 text-transparent",
                )}
              >
                <Check className="h-3 w-3" />
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
