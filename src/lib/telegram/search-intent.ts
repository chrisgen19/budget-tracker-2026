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
      /** First local day of an explicit range, YYYY-MM-DD. Never set alongside `month`. */
      from: string | null;
      /** Last local day of an explicit range, YYYY-MM-DD, inclusive. Never set alongside `month`. */
      to: string | null;
      /**
       * Which side of the ledger the question was about.
       *
       * Defaults to EXPENSE because every phrasing this intent serves is a spending one: spent,
       * paid, bought. Without it a refund or an income row sharing a description was listed and
       * counted as evidence of paying, while the total quietly excluded it, so the count and the
       * total described different sets.
       */
      type: "EXPENSE" | "INCOME";
      /** What to call this back to the user, built from what actually resolved. */
      subject: string;
    }
  | { kind: "BILL"; search: string; month: string | null }
  | null;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A day that actually exists, not merely one shaped like a date.
 *
 * `Date.UTC(2026, 1, 31)` rolls forward to 3 March rather than failing, and the server refuses
 * such a day outright. Dropping it here keeps the same bargain the rest of this file makes: the
 * query widens instead of asking for a window nobody meant.
 */
const validDay = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const match = DAY.exec(value.trim());
  if (!match) return null;

  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const rolled = new Date(Date.UTC(year, month - 1, day));
  const real =
    rolled.getUTCFullYear() === year &&
    rolled.getUTCMonth() === month - 1 &&
    rolled.getUTCDate() === day;

  return real ? value.trim() : null;
};

/**
 * Case-insensitive exact match. Deliberately not fuzzy: a near miss silently filters on the
 * wrong label, and "no transactions found" would read like a real answer.
 *
 * Exported because the write path needs the same discipline for a stronger reason. A model that
 * names a label for a *search* costs a wrong answer; one that names it for a `create_transactions`
 * writes the wrong label onto a row, and `getLabelBreakdown` splits an amount across whatever
 * labels it carries, so that quietly moves money in the breakdown.
 */
export const findByName = (refs: NamedRef[], name: unknown): NamedRef | null => {
  if (typeof name !== "string" || !name.trim()) return null;
  const needle = name.trim().toLowerCase();
  return refs.find((r) => r.name.toLowerCase() === needle) ?? null;
};

/**
 * Read a searching intent out of the classifier's reply, or return null to let it fall through.
 *
 * Everything here is validated against real data rather than trusted. Gemini is asked to name a
 * label, a category and a period, and it can return a label that does not exist, "August" instead
 * of "2026-08", a day that is not on the calendar, a range running backwards, or the right action
 * with nothing to search for.
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

  const { action, search, label, category, month, from, to, type } = result as Record<
    string,
    unknown
  >;
  const validMonth = typeof month === "string" && MONTH.test(month) ? month : null;

  // A month and an explicit range cannot both be sent: the server refuses the pair rather than
  // silently choosing one. When the model returns both, the month wins and the range is dropped,
  // which is the same trade this file makes everywhere else -- answering wider than asked is
  // survivable and visible, answering narrower is a false negative dressed as an answer.
  const rangeFrom = validMonth ? null : validDay(from);
  const rangeTo = validMonth ? null : validDay(to);
  // Lexicographic comparison is exact for YYYY-MM-DD. A backwards range matches nothing, so it
  // is dropped whole rather than half-applied.
  const backwards = rangeFrom !== null && rangeTo !== null && rangeFrom > rangeTo;

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
    // Only an explicit INCOME is honoured; anything else, including a value the model invented,
    // falls back to the spending reading the phrasings imply.
    type: type === "INCOME" ? "INCOME" : "EXPENSE",
    labelId: matchedLabel?.id ?? null,
    categoryId: matchedCategory?.id ?? null,
    month: validMonth,
    from: backwards ? null : rangeFrom,
    to: backwards ? null : rangeTo,
    subject,
  };
};
