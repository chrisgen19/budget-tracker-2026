"use client";

import { useState } from "react";
import { Clock, Check, ChevronRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLabelsQuery, useQuickLabelsQuery } from "@/hooks/use-labels";
import type { LabelWithCountAndSchedules } from "@/types";

/** Number of labels shown before the "More labels..." expander (mirrors Category quick picks). */
const QUICK_LABEL_COUNT = 4;

interface LabelPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  autoAppliedIds?: string[];
  transactionType?: "INCOME" | "EXPENSE";
}

export function LabelPicker({ selectedIds, onChange, autoAppliedIds = [], transactionType }: LabelPickerProps) {
  const [showAll, setShowAll] = useState(false);
  const { data: labels = [] } = useLabelsQuery();
  const { data: quickLabelIds = [] } = useQuickLabelsQuery();

  // Filter labels by transaction type (keep already-selected visible so they can be removed)
  const filteredLabels = transactionType
    ? labels.filter((l) => l.applicableTo === "BOTH" || l.applicableTo === transactionType)
    : labels;

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id]
    );
  };

  // Order: selected first (incl. any type-incompatible so they stay removable),
  // then user-pinned "quick" labels, then everything else.
  const selectedLabels = labels.filter((l) => selectedIds.includes(l.id));
  const unselectedLabels = filteredLabels.filter((l) => !selectedIds.includes(l.id));
  const pinnedUnselected = quickLabelIds
    .map((id) => unselectedLabels.find((l) => l.id === id))
    .filter((l): l is LabelWithCountAndSchedules => l != null);
  const pinnedSet = new Set(pinnedUnselected.map((l) => l.id));
  const restUnselected = unselectedLabels.filter((l) => !pinnedSet.has(l.id));
  const orderedLabels = [...selectedLabels, ...pinnedUnselected, ...restUnselected];

  if (orderedLabels.length === 0) return null;

  // Quick view always shows every selected label + enough suggestions to reach QUICK_LABEL_COUNT.
  const quickLabels = orderedLabels.slice(0, Math.max(QUICK_LABEL_COUNT, selectedLabels.length));
  const hasMore = orderedLabels.length > quickLabels.length;

  const renderChip = (lbl: LabelWithCountAndSchedules) => {
    const isSelected = selectedIds.includes(lbl.id);
    const isAuto = autoAppliedIds.includes(lbl.id);
    return (
      <button
        key={lbl.id}
        type="button"
        onClick={() => toggle(lbl.id)}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full border-2 transition-colors",
          !isSelected &&
            "border-dashed border-cream-300 text-warm-400 hover:border-warm-400 hover:text-warm-500"
        )}
        style={
          isSelected
            ? { backgroundColor: lbl.color + "18", color: lbl.color, borderColor: lbl.color + "55" }
            : undefined
        }
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: lbl.color }} />
        {lbl.name}
        {isAuto && <Clock className="w-3 h-3 opacity-60" />}
        {isSelected && <Check className="w-3 h-3" />}
      </button>
    );
  };

  return (
    <div>
      <p className="text-sm font-semibold text-warm-600 mb-3">
        Labels <span className="font-normal text-warm-300">(Optional)</span>
      </p>

      {showAll ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="flex items-center gap-1.5 text-sm text-warm-400 hover:text-warm-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Done
          </button>
          <div className="flex flex-wrap gap-2">{orderedLabels.map(renderChip)}</div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">{quickLabels.map(renderChip)}</div>
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full flex items-center justify-between px-4 py-3 mt-2.5 rounded-xl border border-cream-200 text-sm text-warm-400 hover:text-warm-600 hover:border-cream-300 transition-colors"
            >
              More labels...
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
