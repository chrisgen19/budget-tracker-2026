/**
 * Whether a label may be used on a transaction, bill or quick-log tile in a given category.
 *
 * Pure, with no Prisma or React dependency, so the picker, the write paths, the schedule matcher
 * and the Telegram resolvers all decide this the same way. The rule reads backwards at a glance
 * and is the one thing worth stating once rather than at every call site:
 *
 *   **A label with no linked categories is unrestricted, not restricted to nothing.**
 *
 * That is what lets `label_categories` ship without a backfill -- every label that predates the
 * table has zero rows and keeps behaving as it always did. It mirrors `applicableTo: "BOTH"`, and
 * composes with it rather than replacing it: a label has to pass both checks.
 *
 * A missing `categoryId` also passes, because there is nothing to check against yet. The
 * transaction form renders the picker before a category is chosen, and a quick-log tile may carry
 * no category at all.
 */
export const labelAllowsCategory = (
  allowedCategoryIds: readonly string[] | undefined,
  categoryId: string | null | undefined,
): boolean =>
  !allowedCategoryIds ||
  allowedCategoryIds.length === 0 ||
  !categoryId ||
  allowedCategoryIds.includes(categoryId);

/** Shape of the `categories` relation as every read path selects it. */
export interface LabelCategoryLink {
  categoryId: string;
}

/** Flattens the relation rows into the id list `labelAllowsCategory` takes. */
export const toAllowedCategoryIds = (
  categories: readonly LabelCategoryLink[] | undefined,
): string[] => (categories ?? []).map((link) => link.categoryId);

/** Convenience for the common case of testing a label row straight from a query. */
export const labelRowAllowsCategory = (
  label: { categories?: readonly LabelCategoryLink[] },
  categoryId: string | null | undefined,
): boolean => labelAllowsCategory(toAllowedCategoryIds(label.categories), categoryId);

/**
 * Whether replacing a label's category restriction *removes* permission it previously granted.
 *
 * The question the edit route asks before offering to strip associations, and the one place the
 * asymmetry is written down. Narrowing is not "the set changed": widening from one category to two
 * changes it and removes nothing, and treating that as a narrowing offered to delete every
 * grandfathered row outside the wider set on an edit that only ever added permission.
 *
 * An **empty new set means every category**, so it can never narrow. An empty *old* set is the
 * mirror of that and always does, since going from unrestricted to any restriction removes the
 * rest of them.
 */
export const categoryRestrictionNarrowed = (
  oldCategoryIds: readonly string[],
  newCategoryIds: readonly string[],
): boolean => {
  if (newCategoryIds.length === 0) return false;
  if (oldCategoryIds.length === 0) return true;
  return oldCategoryIds.some((categoryId) => !newCategoryIds.includes(categoryId));
};
