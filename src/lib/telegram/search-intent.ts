/** What the classifier asked for, once its output has been checked. */
export type SearchIntent =
  | { kind: "SEARCH"; search: string; month: string | null }
  | { kind: "BILL"; search: string; month: string | null }
  | null;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Read a searching intent out of the classifier's reply, or return null to let it fall through.
 *
 * Everything here is validated rather than trusted. Gemini is being asked to pull a term and a
 * month out of a question, and it can return "August" instead of "2026-08", an empty string, or
 * the right action with nothing to search for. A bad month would silently narrow the search to
 * nothing and answer "no transactions", which reads exactly like a real answer, so an
 * unparseable one is dropped and the search runs unfiltered instead.
 */
export const parseSearchIntent = (result: unknown): SearchIntent => {
  if (!result || typeof result !== "object") return null;

  const { action, search, month } = result as Record<string, unknown>;
  if (action !== "SEARCH_TRANSACTIONS" && action !== "CHECK_BILL") return null;

  const term = typeof search === "string" ? search.trim() : "";
  if (!term) return null;

  return {
    kind: action === "CHECK_BILL" ? "BILL" : "SEARCH",
    search: term,
    month: typeof month === "string" && MONTH.test(month) ? month : null,
  };
};
