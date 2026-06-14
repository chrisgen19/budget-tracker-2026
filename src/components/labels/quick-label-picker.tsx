"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
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

  const toggleLabel = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  return (
    <div>
      <p className="text-sm text-warm-400 mb-4">
        Tap to pin labels for quick access. Pinned labels appear first when adding transactions.
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {allLabels.map((lbl) => {
          const order = selectedIds.indexOf(lbl.id);
          const isSelected = order !== -1;

          return (
            <button
              key={lbl.id}
              type="button"
              onClick={() => toggleLabel(lbl.id)}
              className={cn(
                "relative inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full border-2 transition-colors",
                !isSelected &&
                  "border-dashed border-cream-300 text-warm-400 hover:border-warm-400 hover:text-warm-500"
              )}
              style={
                isSelected
                  ? { backgroundColor: lbl.color + "18", color: lbl.color, borderColor: lbl.color + "55" }
                  : undefined
              }
            >
              {isSelected && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber text-white text-[9px] font-bold flex items-center justify-center shadow-sm">
                  {order + 1}
                </span>
              )}
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: lbl.color }} />
              {lbl.name}
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
