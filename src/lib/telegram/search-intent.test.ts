import { describe, expect, it } from "vitest";
import { parseSearchIntent } from "@/lib/telegram/search-intent";

describe("parseSearchIntent", () => {
  it("reads a transaction search", () => {
    expect(
      parseSearchIntent({ action: "SEARCH_TRANSACTIONS", search: "meralco", month: "2026-08" })
    ).toEqual({ kind: "SEARCH", search: "meralco", month: "2026-08" });
  });

  it("reads a bill check", () => {
    expect(parseSearchIntent({ action: "CHECK_BILL", search: "water", month: null })).toEqual({
      kind: "BILL",
      search: "water",
      month: null,
    });
  });

  it("ignores the other actions", () => {
    for (const action of ["SHOW_SUMMARY", "SHOW_RECENT", "SHOW_BILLS", "CREATE_TRANSACTION", "UNSUPPORTED"]) {
      expect(parseSearchIntent({ action, search: "meralco" }), action).toBeNull();
    }
  });

  // A search action with nothing to search for would query everything and present the result as
  // an answer to a specific question.
  it("falls through when there is no term", () => {
    expect(parseSearchIntent({ action: "SEARCH_TRANSACTIONS", search: "" })).toBeNull();
    expect(parseSearchIntent({ action: "SEARCH_TRANSACTIONS", search: "   " })).toBeNull();
    expect(parseSearchIntent({ action: "SEARCH_TRANSACTIONS" })).toBeNull();
    expect(parseSearchIntent({ action: "SEARCH_TRANSACTIONS", search: 42 })).toBeNull();
  });

  it("trims the term, since a stray space would narrow the match", () => {
    expect(parseSearchIntent({ action: "SEARCH_TRANSACTIONS", search: "  meralco  " })).toMatchObject(
      { search: "meralco" }
    );
  });

  // The dangerous case: a month the search layer cannot use would filter everything out, and
  // "no transactions found" reads exactly like a real answer. Dropping it searches unfiltered,
  // which is wider than asked but never falsely negative.
  it("drops a month it cannot use rather than filtering on it", () => {
    for (const month of ["August", "2026-8", "08-2026", "2026-13", "2026-00", "", "next month"]) {
      expect(
        parseSearchIntent({ action: "SEARCH_TRANSACTIONS", search: "meralco", month }),
        String(month)
      ).toMatchObject({ search: "meralco", month: null });
    }
  });

  it("accepts every valid month boundary", () => {
    for (const month of ["2026-01", "2026-09", "2026-10", "2026-12"]) {
      expect(
        parseSearchIntent({ action: "SEARCH_TRANSACTIONS", search: "x", month }),
        month
      ).toMatchObject({ month });
    }
  });

  it("survives junk instead of a result", () => {
    expect(parseSearchIntent(null)).toBeNull();
    expect(parseSearchIntent(undefined)).toBeNull();
    expect(parseSearchIntent("nope")).toBeNull();
    expect(parseSearchIntent(42)).toBeNull();
  });
});
