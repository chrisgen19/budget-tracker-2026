/**
 * Hard limit on pinned quick-access labels.
 *
 * Lives here rather than in the picker so `PATCH /api/preferences` can enforce the same number the
 * UI does without importing a client component. The categories equivalent is MAX_QUICK_CATEGORIES
 * in ./quick-categories.
 */
export const MAX_QUICK_LABELS = 6;
