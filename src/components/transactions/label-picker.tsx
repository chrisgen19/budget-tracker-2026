"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Clock, Plus, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLabelsQuery } from "@/hooks/use-labels";

interface LabelPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  autoAppliedIds?: string[];
}

export function LabelPicker({ selectedIds, onChange, autoAppliedIds = [] }: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data: labels = [] } = useLabelsQuery();

  const checkPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenUpward(spaceBelow < 220);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
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

  if (labels.length === 0) return null;

  return (
    <div>
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
        <div className="relative" ref={dropdownRef}>
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

          {/* Dropdown */}
          {open && (
            <div
              className={cn(
                "absolute left-0 z-50 w-56 bg-white rounded-xl shadow-soft-md border border-cream-200 py-1.5 max-h-48 overflow-y-auto",
                openUpward ? "bottom-full mb-1.5" : "top-full mt-1.5"
              )}
            >
              {labels.map((lbl) => {
                const isSelected = selectedIds.includes(lbl.id);
                return (
                  <button
                    key={lbl.id}
                    type="button"
                    onClick={() => toggle(lbl.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
