import type { LabelWithCountAndSchedules } from "@/types";

/**
 * Quick label choices, shared by `LabelPicker` and the scan review chips so the two can never
 * offer a different four for the same receipt.
 */

/**
 * Hard limit on pinned quick-access labels.
 *
 * Lives here rather than in the picker so `PATCH /api/preferences` can enforce the same number the
 * UI does without importing a client component. The categories equivalent is MAX_QUICK_CATEGORIES
 * in ./quick-categories.
 */
export const MAX_QUICK_LABELS = 6;

/** Minimum number of stable quick choices shown before the full picker. */
export const QUICK_LABEL_COUNT = 4;

type TransactionType = "INCOME" | "EXPENSE";

export const isLabelCompatible = (
  label: Pick<LabelWithCountAndSchedules, "applicableTo">,
  transactionType?: TransactionType,
) =>
  !transactionType ||
  label.applicableTo === "BOTH" ||
  label.applicableTo === transactionType;

export const byLabelName = (
  a: Pick<LabelWithCountAndSchedules, "name">,
  b: Pick<LabelWithCountAndSchedules, "name">,
) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Most-used in this category first, then most-used overall, then alphabetical.
 *
 * The category tier is what makes the chips useful: filing Transportation should surface the label
 * used for Transportation, not the one with the largest total. The total tier still decides when a
 * category has no history -- on a new category every count is zero, and falling straight to
 * alphabetical would put Alpha ahead of a label carrying four hundred transactions.
 *
 * A missing entry is zero, never an exclusion. Every compatible label remains reachable; this only
 * decides which four are shown before "show all".
 */
const byUsageThenName =
  (categoryId?: string) =>
  (a: LabelWithCountAndSchedules, b: LabelWithCountAndSchedules) => {
    const here = (label: LabelWithCountAndSchedules) =>
      categoryId ? (label.categoryCounts[categoryId] ?? 0) : 0;
    return (
      here(b) - here(a) ||
      b._count.transactions - a._count.transactions ||
      byLabelName(a, b)
    );
  };

/**
 * The quick label chips for a transaction: the user's pins in pin order, then backfilled by usage.
 *
 * Never depends on what is selected, so choosing a label cannot make the chips jump around.
 * Capped at `QUICK_LABEL_COUNT`, or at the number of pins when the user pinned more.
 *
 * @param labels every label the user has
 * @param pinnedIds `quickLabels` from preferences, in display order
 * @param transactionType excludes labels restricted to the other type
 * @param categoryId the category being filed under; orders the backfill, never filters it
 */
export const resolveQuickLabels = <T extends LabelWithCountAndSchedules>(
  labels: T[],
  pinnedIds: string[],
  transactionType?: TransactionType,
  categoryId?: string,
): T[] => {
  const compatible = labels.filter((label) => isLabelCompatible(label, transactionType));
  const compatibleById = new Map(compatible.map((label) => [label.id, label]));
  const pinned = pinnedIds
    .map((id) => compatibleById.get(id))
    .filter((label): label is T => label != null);
  const pinnedSet = new Set(pinned.map((label) => label.id));
  const backfill = compatible
    .filter((label) => !pinnedSet.has(label.id))
    .sort(byUsageThenName(categoryId));

  return [...pinned, ...backfill].slice(0, Math.max(QUICK_LABEL_COUNT, pinned.length));
};
