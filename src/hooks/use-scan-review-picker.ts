import { useState } from "react";
import type { ScanPickerKind } from "@/components/scan-review/scan-quick-chips";
import type { MultiScanItem } from "@/types";

export const SCAN_REVIEW_TITLE = "Review Scanned Receipts";

/**
 * Which receipt's full category or label picker (the More chip) is open in the scan review.
 *
 * Owned by the app shell rather than by `MultiScanReview` because the shell owns the `Modal`
 * around it. Escape, the backdrop, the X and the mobile drag-down all call that Modal's single
 * `onClose`, and while the picker was local state the shell could not tell it was open: every
 * one of those gestures went straight to "Discard scanned receipts?" when the user only meant
 * to back out of More. `interceptClose` is the shell's way to ask first.
 */
export function useScanReviewPicker(items: MultiScanItem[]) {
  const [state, setState] = useState<{ itemId: string; kind: ScanPickerKind } | null>(null);

  // Resolved against the live list every render: a receipt removed, or sent back to
  // itemizing, while its picker was open simply drops back to the list.
  const item = state
    ? items.find((i) => i.id === state.itemId && i.status === "success")
    : undefined;
  const picker = state && item ? { ...state, item } : null;

  const name = picker?.item.data?.description || "this receipt";
  const title = picker
    ? `${picker.kind === "category" ? "Category" : "Labels"} for ${name}`
    : SCAN_REVIEW_TITLE;

  const close = () => setState(null);

  return {
    picker,
    title,
    open: (itemId: string, kind: ScanPickerKind) => setState({ itemId, kind }),
    close,
    /** Closes an open picker and returns true, so the caller stops there; false otherwise. */
    interceptClose: () => {
      if (!picker) return false;
      close();
      return true;
    },
  };
}
