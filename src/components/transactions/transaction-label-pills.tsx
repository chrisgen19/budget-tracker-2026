"use client";

import { X } from "lucide-react";
import type { Label, TransactionLabel } from "@/types";

interface TransactionLabelPillsProps {
  labels: (TransactionLabel & { label: Label })[];
  /** Max pills to show before "+N" overflow */
  maxVisible?: number;
  /** Called when the user clicks the X on a pill. Omit to hide remove buttons. */
  onRemove?: (transactionLabelId: string, labelId: string) => void;
}

export function TransactionLabelPills({
  labels,
  maxVisible = 2,
  onRemove,
}: TransactionLabelPillsProps) {
  if (labels.length === 0) return null;

  const visible = labels.slice(0, maxVisible);
  const overflow = labels.length - maxVisible;

  return (
    <>
      <span className="text-warm-200">&middot;</span>
      {visible.map((tl) => (
        <span
          key={tl.id}
          className="group/pill inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
          style={{
            backgroundColor: tl.label.color + "18",
            color: tl.label.color,
          }}
        >
          {tl.label.name}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(tl.id, tl.labelId);
              }}
              className="hidden sm:group-hover/pill:inline-flex items-center justify-center w-3 h-3 -mr-0.5 rounded-full hover:bg-black/10 transition-colors"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[10px] text-warm-300 shrink-0">
          +{overflow}
        </span>
      )}
    </>
  );
}
