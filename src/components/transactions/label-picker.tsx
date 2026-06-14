"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Clock, Plus, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLabelsQuery } from "@/hooks/use-labels";
import { useIsMobile } from "@/hooks/use-is-mobile";

interface LabelPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  autoAppliedIds?: string[];
  transactionType?: "INCOME" | "EXPENSE";
}

export function LabelPicker({ selectedIds, onChange, autoAppliedIds = [], transactionType }: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();
  const { data: labels = [] } = useLabelsQuery();

  // Filter labels by transaction type (keep already-selected visible in pills)
  const filteredLabels = transactionType
    ? labels.filter((l) => l.applicableTo === "BOTH" || l.applicableTo === transactionType)
    : labels;

  // Desktop only: flip the floating dropdown upward when there's little space below
  const checkPosition = useCallback(() => {
    if (isMobile || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenUpward(spaceBelow < 220);
  }, [isMobile]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id]
    );
  };

  const remove = (id: string) => {
    onChange(selectedIds.filter((s) => s !== id));
  };

  const selectedLabels = labels.filter((l) => selectedIds.includes(l.id));

  if (filteredLabels.length === 0 && selectedLabels.length === 0) return null;

  const renderOption = (lbl: (typeof filteredLabels)[number]) => {
    const isSelected = selectedIds.includes(lbl.id);
    return (
      <button
        key={lbl.id}
        type="button"
        onClick={() => toggle(lbl.id)}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 text-left text-sm transition-colors",
          // Bigger touch targets on mobile
          isMobile ? "py-3" : "py-2",
          isSelected
            ? "bg-amber-light/40 text-warm-700"
            : "text-warm-500 hover:bg-cream-50"
        )}
      >
        <span
          className="w-3 h-3 rounded-full shrink-0 ring-1 ring-inset ring-black/5"
          style={{ backgroundColor: lbl.color }}
        />
        <span className="flex-1 truncate">{lbl.name}</span>
        {isSelected && (
          <span className="text-amber text-xs font-medium">Added</span>
        )}
      </button>
    );
  };

  return (
    <div ref={rootRef}>
      <p className="text-sm font-semibold text-warm-600 mb-3">
        Labels{" "}
        <span className="font-normal text-warm-300">(Optional)</span>
      </p>

      {/* Selected labels as pills */}
      <div className="flex flex-wrap items-center gap-2">
        {selectedLabels.map((lbl) => {
          const isAuto = autoAppliedIds.includes(lbl.id);
          return (
          <span
            key={lbl.id}
            className="inline-flex items-center gap-1.5 text-xs font-medium pl-2.5 pr-1.5 py-1 rounded-full"
            style={{
              backgroundColor: lbl.color + "18",
              color: lbl.color,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: lbl.color }}
            />
            {lbl.name}
            {isAuto && (
              <Clock className="w-3 h-3 opacity-60" />
            )}
            <button
              type="button"
              onClick={() => remove(lbl.id)}
              className="p-0.5 rounded-full hover:bg-black/10 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
          );
        })}

        {/* Add label button / dropdown trigger */}
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => {
              checkPosition();
              setOpen(!open);
            }}
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border-2 border-dashed transition-colors",
              open
                ? "border-amber text-amber"
                : "border-cream-300 text-warm-400 hover:border-warm-400 hover:text-warm-500"
            )}
          >
            <Plus className="w-3 h-3" />
            Add
            <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
          </button>

          {/* Desktop: compact floating dropdown anchored to the trigger */}
          {open && !isMobile && (
            <div
              className={cn(
                "absolute left-0 z-50 w-56 bg-white rounded-xl shadow-soft-md border border-cream-200 py-1.5 max-h-48 overflow-y-auto",
                openUpward ? "bottom-full mb-1.5" : "top-full mt-1.5"
              )}
            >
              {filteredLabels.map(renderOption)}
            </div>
          )}
        </div>
      </div>

      {/* Mobile: full-width inline panel that pushes form content down */}
      {open && isMobile && (
        <div className="mt-3 bg-white rounded-xl shadow-soft-md border border-cream-200 py-1 max-h-60 overflow-y-auto">
          {filteredLabels.map(renderOption)}
        </div>
      )}
    </div>
  );
}
