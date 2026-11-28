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
  /**
   * Below `sm`, show only the first pill, let it shrink to at most 55% of the line with its
   * name truncated, and count the rest as "+N". Without this the pills were `shrink-0`, so on a
   * 390px phone they squeezed the category beside them to nothing and were then cut mid-word.
   */
  collapseOnPhone?: boolean;
}

// No display utility here: `cn`-style joins do not merge, so each layout below owns it.
const PILL_BASE =
  "group/pill items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full transition-opacity";
const COUNT_BASE = "text-[10px] text-warm-300 shrink-0";

/**
 * Responsive classes for the pill at `index`; see `collapseOnPhone`. The first pill shrinks four
 * times as fast as the category beside it, so a long label gives way before the category does.
 */
const pillLayoutClass = (index: number, collapseOnPhone: boolean) => {
  if (!collapseOnPhone) return "inline-flex shrink-0";
  if (index === 0) return "inline-flex min-w-10 max-w-[55%] shrink-[4] sm:max-w-none sm:shrink-0";
  return "hidden sm:inline-flex shrink-0";
};

export function TransactionLabelPills({
  labels,
  maxVisible = 2,
  onRemove,
  removingLabelId,
  removeDisabled,
  collapseOnPhone = false,
}: TransactionLabelPillsProps) {
  // On mobile, tap a pill to reveal X; tap again or tap elsewhere to dismiss
  const [activePillId, setActivePillId] = useState<string | null>(null);

  if (labels.length === 0) return null;

  const visible = labels.slice(0, maxVisible);
  const overflow = labels.length - maxVisible;
  const phoneOverflow = collapseOnPhone ? labels.length - 1 : overflow;

  return (
    <>
      <span className="text-warm-200">&middot;</span>
      {visible.map((tl, index) => {
        const isRemoving = removingLabelId === tl.labelId;
        const isActive = activePillId === tl.id;
        return (
          <span
            key={tl.id}
            className={`${PILL_BASE} ${pillLayoutClass(index, collapseOnPhone)}`}
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
            <span className={collapseOnPhone ? "truncate" : undefined}>{tl.label.name}</span>
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
                      ? "inline-flex shrink-0 items-center justify-center w-3 h-3 -mr-0.5 rounded-full hover:bg-black/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                      : "hidden sm:group-hover/pill:inline-flex shrink-0 items-center justify-center w-3 h-3 -mr-0.5 rounded-full hover:bg-black/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  }
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )
            )}
          </span>
        );
      })}
      {phoneOverflow === overflow ? (
        overflow > 0 && <span className={COUNT_BASE}>{`+${overflow}`}</span>
      ) : (
        <>
          {phoneOverflow > 0 && (
            <span className={`${COUNT_BASE} sm:hidden`}>{`+${phoneOverflow}`}</span>
          )}
          {overflow > 0 && (
            <span className={`${COUNT_BASE} hidden sm:inline`}>{`+${overflow}`}</span>
          )}
        </>
      )}
    </>
  );
}
