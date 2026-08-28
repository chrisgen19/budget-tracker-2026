/**
 * Where a scan result goes when Gemini names a category the user does not have.
 *
 * The correction is silent by design — an invented id would fail the ownership check on write —
 * so the destination has to be the honest one. This looked for a category named "Other", which
 * no installation has: the seeded name is "Other Expense". The lookup therefore always missed,
 * and every unmatched result fell through to `categories[0]`, which under the categories query's
 * `isDefault desc, name asc` ordering is whichever default sorts first alphabetically —
 * "Entertainment" on a standard install. Misread receipts were quietly filed as entertainment
 * spending, with nothing surfacing the substitution.
 *
 * Shared rather than duplicated because it was wrong in both callers at once, and kept free of
 * imports so neither caller's test has to mock a module to reach it.
 */
export const resolveFallbackCategory = <T extends { name: string }>(
  categories: T[]
): T | undefined => categories.find((c) => c.name === "Other Expense") ?? categories[0];
