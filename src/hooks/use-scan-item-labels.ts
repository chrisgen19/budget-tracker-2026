import { useScheduledLabel } from "@/hooks/use-scheduled-label";
import type { MultiScanItem } from "@/types";

/**
 * The labels a scanned receipt will be saved with, as the review should show them.
 *
 * `labelIds: undefined` is not "no labels": the batch save omits the key and the server applies
 * the label schedule. Showing that row as unlabelled would make the first chip tap silently drop
 * the scheduled label, since a tap has to write an explicit list. So an untouched row shows the
 * label the schedule would pick, and the first tap seeds from it.
 */
export const effectiveLabelIds = (
  labelIds: string[] | undefined,
  scheduledLabelId: string | null,
): string[] => labelIds ?? (scheduledLabelId ? [scheduledLabelId] : []);

/** Toggle one id in a label list, keeping the order the rest were chosen in. */
export const toggleLabelId = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];

/**
 * Label state for one scanned receipt in the review.
 *
 * @returns `selectedIds` to render, `scheduledLabelId` while it is still the schedule's choice
 *   (for the clock marker), and `toggle`, which returns the explicit list to write.
 */
export function useScanItemLabels(item: MultiScanItem) {
  const data = item.data;
  // Resolved exactly as the batch save resolves it, so the preview matches what the server sees.
  const instant = data?.date ? new Date(data.date).toISOString() : undefined;
  const { scheduledLabelId } = useScheduledLabel(instant, data?.type);
  const selectedIds = effectiveLabelIds(data?.labelIds, scheduledLabelId);

  return {
    selectedIds,
    autoAppliedId: data?.labelIds === undefined ? scheduledLabelId : null,
    toggle: (id: string) => toggleLabelId(selectedIds, id),
  };
}
