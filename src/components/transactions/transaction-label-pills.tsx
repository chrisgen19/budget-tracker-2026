"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Label, TransactionLabel } from "@/types";

interface TransactionLabelPillsProps {
  labels: (TransactionLabel & { label: Label })[];
  /** Max pills to show before "+N" overflow */
  maxVisible?: number;
  /** Called when the user clicks the X on a pill. Omit to hide remove buttons. */
  onRemove?: (transactionLabelId: string, labelId: string) => void;
  /** Label ID currently being removed (shows spinner instead of X) */
  removingLabelId?: string | null;
  /** Disable all remove buttons (e.g. while another remove is in flight) */
  removeDisabled?: boolean;
}

export function TransactionLabelPills({
  labels,
  maxVisible = 2,
  onRemove,
  removingLabelId,
  removeDisabled,
}: TransactionLabelPillsProps) {
  // On mobile, tap a pill to reveal X; tap again or tap elsewhere to dismiss
  const [activePillId, setActivePillId] = useState<string | null>(null);

  if (labels.length === 0) return null;

  const visible = labels.slice(0, maxVisible);
  const overflow = labels.length - maxVisible;

  return (
    <>
      <span className="text-warm-200">&middot;</span>
      {visible.map((tl) => {
        const isRemoving = removingLabelId === tl.labelId;
        const isActive = activePillId === tl.id;
        return (
          <span
            key={tl.id}
            className="group/pill inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 transition-opacity"
            style={{
              backgroundColor: tl.label.color + "18",
              color: tl.label.color,
              opacity: isRemoving ? 0.5 : 1,
            }}
            onClick={(e) => {
              if (!onRemove || isRemoving) return;
              // On mobile: toggle active state to reveal X button
              e.stopPropagation();
              setActivePillId(isActive ? null : tl.id);
            }}
          >
            {tl.label.name}
            {onRemove && (
              isRemoving ? (
                <Loader2 className="w-2.5 h-2.5 -mr-0.5 animate-spin" />
              ) : (
                <button
                  type="button"
                  disabled={removeDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActivePillId(null);
                    onRemove(tl.id, tl.labelId);
                  }}
                  className={
                    isActive
                      ? "inline-flex items-center justify-center w-3 h-3 -mr-0.5 rounded-full hover:bg-black/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                      : "hidden sm:group-hover/pill:inline-flex items-center justify-center w-3 h-3 -mr-0.5 rounded-full hover:bg-black/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  }
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )
            )}
          </span>
        );
      })}
      {overflow > 0 && (
        <span className="text-[10px] text-warm-300 shrink-0">
          +{overflow}
        </span>
      )}
    </>
  );
}
