/**
 * Quick-pick category resolution.
 *
 * `users.quick_expense_categories` / `quick_income_categories` are plain `String[]` columns, not
 * foreign keys, so nothing stops them holding the id of a category that has since been deleted.
 * The row of quick tiles drops such an id, but the picker counts whatever it is handed against its
 * four-slot limit: given a stored list of four where one no longer resolves, the picker believes it
 * is full and disables every remaining tile, so the fourth slot can never be filled again.
 *
 * Keeping both answers in one place is what stops them drifting apart.
 */

/** Hard limit on quick tiles, enforced by the picker and used as the display fallback size. */
export const MAX_QUICK_CATEGORIES = 4;

export interface QuickCategorySelection<T> {
  /** What the quick row renders, falling back to the first few categories. */
  display: T[];
  /** What the picker treats as selected: stored, still-existing categories only. */
  selectedIds: string[];
}

/**
 * Resolve stored quick-pick ids against the categories that actually exist.
 *
 * @param storedIds ids as held in the user's preferences, in display order
 * @param allCategories every category available for this transaction type
 */
export const resolveQuickCategories = <T extends { id: string }>(
  storedIds: string[],
  allCategories: T[]
): QuickCategorySelection<T> => {
  // Deduplicated and capped here rather than trusted from the column. PATCH /api/preferences checks
  // only `length > 4` and the element type, so a caller that posts the same id four times gets it
  // stored verbatim; the picker would then count four entries against its limit while showing one
  // tile selected, which is the same dead end a deleted id used to cause. The cap is unreachable
  // through that route today and is kept so the function's guarantee holds for any caller.
  const stored = [...new Set(storedIds)]
    .map((id) => allCategories.find((c) => c.id === id))
    .filter((c): c is T => c != null)
    .slice(0, MAX_QUICK_CATEGORIES);

  return {
    // The fallback is display only. Feeding it back to the picker would open a first-time picker
    // already at its limit, which reads as the same bug it exists to prevent.
    display: stored.length > 0 ? stored : allCategories.slice(0, MAX_QUICK_CATEGORIES),
    selectedIds: stored.map((c) => c.id),
  };
};
