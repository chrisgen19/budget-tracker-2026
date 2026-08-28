/**
 * Category routing rules, held as data rather than as prose inside a prompt string.
 *
 * The invariant worth enforcing is that every category a prompt routes to is one the install
 * actually has. That cannot be checked on rendered text: telling a category rule from a prose
 * rule that also contains a colon needs a heuristic, and every heuristic has a blind spot where
 * exactly the mistake it looks for can hide. A rule named "Household Cleaning and Maintenance"
 * slips past a length check while still instructing Gemini to return a category nobody has,
 * which then falls through to the same name-similarity misrouting that put cleaning supplies in
 * the rent category.
 *
 * With the name as a field, the test compares it against DEFAULT_CATEGORIES exactly.
 */
export interface CategoryRule {
  /** Must match a category name in DEFAULT_CATEGORIES. */
  category: string;
  /** What belongs in it, rendered after the name. */
  matches: string;
}

/**
 * Render category rules and the ambiguity-resolving rules that follow them as one continuously
 * numbered block, so the prompt reads as a single list.
 */
export const renderCategoryRules = (
  rules: readonly CategoryRule[],
  guidance: readonly string[]
): string =>
  [...rules.map((r) => `${r.category}: ${r.matches}`), ...guidance]
    .map((line, i) => `${i + 1}. ${line}`)
    .join("\n");
