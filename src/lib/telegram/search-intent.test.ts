import { describe, expect, it } from "vitest";
import { parseSearchIntent, type NamedRef } from "@/lib/telegram/search-intent";

/** Shaped like the real data, including a label whose name never appears in any description. */
const LABELS: NamedRef[] = [
  { id: "lbl_work", name: "Work Budget" },
  { id: "lbl_shopee", name: "Shopee" },
  { id: "lbl_family", name: "Family Budget" },
];

const CATEGORIES: NamedRef[] = [
  { id: "cat_transport", name: "Transportation" },
  { id: "cat_food", name: "Food & Dining" },
];

const refs = { labels: LABELS, categories: CATEGORIES };
const parse = (result: unknown) => parseSearchIntent(result, refs);

describe("parseSearchIntent", () => {
  it("reads a plain description search", () => {
    expect(parse({ action: "SEARCH_TRANSACTIONS", search: "meralco", month: "2026-08" })).toEqual({
      kind: "SEARCH",
      search: "meralco",
      labelId: null,
      categoryId: null,
      month: "2026-08",
      subject: "meralco",
    });
  });

  // The gap this closes: "shopee" is a label, not a word in any description. A description-only
  // search returned nothing and reported "no transactions", which reads like a real answer.
  it("resolves a label name to its id", () => {
    expect(parse({ action: "SEARCH_TRANSACTIONS", label: "Shopee", month: "2026-08" })).toMatchObject(
      { labelId: "lbl_shopee", search: null, subject: "Shopee" }
    );
  });

  it("resolves a category and a label together", () => {
    expect(
      parse({
        action: "SEARCH_TRANSACTIONS",
        category: "Transportation",
        label: "Work Budget",
        month: "2026-08",
      })
    ).toMatchObject({
      categoryId: "cat_transport",
      labelId: "lbl_work",
      month: "2026-08",
      subject: "Transportation in Work Budget",
    });
  });

  it("matches names case-insensitively, since the user typed them", () => {
    expect(parse({ action: "SEARCH_TRANSACTIONS", label: "work budget" })).toMatchObject({
      labelId: "lbl_work",
    });
  });

  // Dropping an unknown name rather than filtering on it: an unmatched filter returns zero rows,
  // and zero rows is indistinguishable from a real "no".
  it("drops a label that does not exist rather than filtering on it", () => {
    expect(parse({ action: "SEARCH_TRANSACTIONS", label: "Holiday Fund", search: "flights" })).toMatchObject(
      { labelId: null, search: "flights" }
    );
  });

  it("does not fuzzy-match a near miss", () => {
    // "Work" is not "Work Budget". Guessing here would filter on a label the user did not name.
    expect(parse({ action: "SEARCH_TRANSACTIONS", label: "Work", search: "uv" })).toMatchObject({
      labelId: null,
    });
  });

  // Passing the label name as a description filter too would exclude everything: the rows carry
  // the label but do not mention it in their text.
  it("does not also search the description for a name it resolved", () => {
    expect(parse({ action: "SEARCH_TRANSACTIONS", label: "Shopee", search: "Shopee" })).toMatchObject(
      { labelId: "lbl_shopee", search: null }
    );
  });

  it("abandons the intent when nothing at all resolves", () => {
    // Otherwise it would query everything and present the result as a specific answer.
    expect(parse({ action: "SEARCH_TRANSACTIONS", label: "Nope", category: "Nope" })).toBeNull();
    expect(parse({ action: "SEARCH_TRANSACTIONS", search: "  " })).toBeNull();
    expect(parse({ action: "SEARCH_TRANSACTIONS" })).toBeNull();
  });

  it("drops a month it cannot use rather than filtering on it", () => {
    for (const month of ["August", "2026-8", "2026-13", "", "next month"]) {
      expect(parse({ action: "SEARCH_TRANSACTIONS", search: "meralco", month }), String(month))
        .toMatchObject({ search: "meralco", month: null });
    }
  });

  it("accepts valid month boundaries", () => {
    for (const month of ["2026-01", "2026-09", "2026-12"]) {
      expect(parse({ action: "SEARCH_TRANSACTIONS", search: "x", month }), month).toMatchObject({
        month,
      });
    }
  });

  it("reads a bill check, which stays a name match", () => {
    expect(parse({ action: "CHECK_BILL", search: "water", month: "2026-08" })).toEqual({
      kind: "BILL",
      search: "water",
      month: "2026-08",
    });
  });

  it("ignores the other actions", () => {
    for (const action of ["SHOW_SUMMARY", "SHOW_RECENT", "SHOW_BILLS", "CREATE_TRANSACTION", "UNSUPPORTED"]) {
      expect(parse({ action, search: "meralco", label: "Shopee" }), action).toBeNull();
    }
  });

  it("survives junk instead of a result", () => {
    for (const junk of [null, undefined, "nope", 42]) {
      expect(parse(junk), String(junk)).toBeNull();
    }
  });

  it("works with no reference lists at all", () => {
    // The bot fetches labels only on the Gemini path; a caller without them must still be safe.
    expect(parseSearchIntent({ action: "SEARCH_TRANSACTIONS", label: "Shopee" })).toBeNull();
    expect(parseSearchIntent({ action: "SEARCH_TRANSACTIONS", search: "meralco" })).toMatchObject({
      search: "meralco",
    });
  });
});
