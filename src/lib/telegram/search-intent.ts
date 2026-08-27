/** A named thing the user can filter by, as the bot already has it from MCP. */
export interface NamedRef {
  id: string;
  name: string;
}

/** What the classifier asked for, once its output has been checked against real data. */
export type SearchIntent =
  | {
      kind: "SEARCH";
      /** Free-text description match, when the user named something that is not a label or category. */
      search: string | null;
      labelId: string | null;
      categoryId: string | null;
      month: string | null;
      /** What to call this back to the user, built from what actually resolved. */
      subject: string;
    }
  | { kind: "BILL"; search: string; month: string | null }
  | null;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Case-insensitive exact match. Deliberately not fuzzy: a near miss silently filters on the
 *  wrong label, and "no transactions found" would read like a real answer. */
const findByName = (refs: NamedRef[], name: unknown): NamedRef | null => {
  if (typeof name !== "string" || !name.trim()) return null;
  const needle = name.trim().toLowerCase();
  return refs.find((r) => r.name.toLowerCase() === needle) ?? null;
};

/**
 * Read a searching intent out of the classifier's reply, or return null to let it fall through.
 *
 * Everything here is validated against real data rather than trusted. Gemini is asked to name a
 * label, a category and a month, and it can return a label that does not exist, "August" instead
 * of "2026-08", or the right action with nothing to search for.
 *
 * Every one of those failures is dangerous in the same specific way: a filter the query cannot
 * satisfy returns zero rows, and "no transactions found" reads exactly like a real answer to
 * "did I pay meralco". So an unresolvable name or month is dropped rather than passed through,
 * which searches wider than asked but is never falsely negative. If nothing at all resolves, the
 * intent is abandoned instead of querying everything and presenting it as a specific answer.
 */
export const parseSearchIntent = (
  result: unknown,
  refs: { labels?: NamedRef[]; categories?: NamedRef[] } = {}
): SearchIntent => {
  if (!result || typeof result !== "object") return null;

  const { action, search, label, category, month } = result as Record<string, unknown>;
  const validMonth = typeof month === "string" && MONTH.test(month) ? month : null;

  if (action === "CHECK_BILL") {
    const term = typeof search === "string" ? search.trim() : "";
    return term ? { kind: "BILL", search: term, month: validMonth } : null;
  }

  if (action !== "SEARCH_TRANSACTIONS") return null;

  const matchedLabel = findByName(refs.labels ?? [], label);
  const matchedCategory = findByName(refs.categories ?? [], category);
  // Only used when it is not just restating a label or category the user already named, which
  // would filter on the description as well and exclude everything.
  const rawSearch = typeof search === "string" ? search.trim() : "";
  const term =
    rawSearch &&
    rawSearch.toLowerCase() !== (matchedLabel?.name.toLowerCase() ?? "") &&
    rawSearch.toLowerCase() !== (matchedCategory?.name.toLowerCase() ?? "")
      ? rawSearch
      : null;

  if (!matchedLabel && !matchedCategory && !term) return null;

  const subject = [matchedCategory?.name, matchedLabel?.name, term].filter(Boolean).join(" in ");

  return {
    kind: "SEARCH",
    search: term,
    labelId: matchedLabel?.id ?? null,
    categoryId: matchedCategory?.id ?? null,
    month: validMonth,
    subject,
  };
};
