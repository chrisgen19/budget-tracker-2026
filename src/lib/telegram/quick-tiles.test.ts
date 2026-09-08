import { describe, expect, it } from "vitest";
import type { BotCategory } from "@/lib/telegram/category-match";
import {
  MAX_QUICK_TILES,
  SORT_ORDER_GAP,
  nextSortOrder,
  resolveTileCategory,
  tileFallsBack,
} from "@/lib/telegram/quick-tiles";

/**
 * The seeded defaults, in the order `get_category_list` returns them.
 *
 * Same fixture as `quick-keyboard.test.ts`, and for the same reason: these tests drive the **real**
 * `matchCategory` and `findOtherCategory` rather than a copy of their rules. A second copy of the
 * ladder here could keep agreeing with itself long after the matcher had moved on, which is
 * exactly the failure it is supposed to catch.
 */
const CATEGORIES: BotCategory[] = [
  "Entertainment",
  "Food & Dining",
  "Fun",
  "Groceries",
  "Healthcare",
  "Home Supplies",
  "Housing",
  "Other Expense",
  "Personal Care",
  "Shopping",
  "Transportation",
  "Utilities",
].map((name) => ({ id: name.toLowerCase(), name, type: "EXPENSE" }));

const tile = (over: Partial<Parameters<typeof resolveTileCategory>[0]> = {}) => ({
  description: "fare to office",
  type: "EXPENSE" as const,
  categoryId: null as string | null,
  ...over,
});

describe("resolveTileCategory", () => {
  it("uses the stored category when it still exists", () => {
    // The user already answered this question when they made the tile. Deriving from a
    // twelve-character description would be throwing away the better signal.
    const result = resolveTileCategory(tile({ categoryId: "groceries" }), CATEGORIES);

    expect(result).toEqual({ categoryId: "groceries", categoryName: "Groceries", via: "tile" });
  });

  it("derives from the description when the tile has no category", () => {
    const result = resolveTileCategory(tile(), CATEGORIES);

    expect(result).toEqual({
      categoryId: "transportation",
      categoryName: "Transportation",
      via: "matched",
    });
  });

  it("falls back when the stored category has been deleted", () => {
    // The FK is `SetNull`, so this is what the row looks like the moment a category is deleted in
    // the web app. The button must keep working, and must file somewhere sensible.
    const result = resolveTileCategory(tile({ categoryId: "deleted-id" }), CATEGORIES);

    expect(result?.via).toBe("matched");
    expect(result?.categoryName).toBe("Transportation");
  });

  it("falls back when the stored category's type no longer matches", () => {
    // `PUT /api/categories/[id]` lets a custom category's type be flipped underneath its
    // transactions, and `categoriesAreUsable` refuses a mismatched pair *inside* the write
    // transaction. Without this re-check, a type flip elsewhere in the app turns a tap into a
    // CATEGORIES_NOT_OWNED rejection instead of a logged row.
    const flipped = [...CATEGORIES, { id: "side-gig", name: "Side Gig", type: "INCOME" }];

    const result = resolveTileCategory(tile({ categoryId: "side-gig" }), flipped);

    expect(result?.via).toBe("matched");
    expect(result?.categoryId).toBe("transportation");
  });

  it("lands on Other Expense when nothing matches", () => {
    const result = resolveTileCategory(tile({ description: "misc thing" }), CATEGORIES);

    expect(result).toEqual({
      categoryId: "other expense",
      categoryName: "Other Expense",
      via: "other",
    });
  });

  it("returns null rather than picking the first category", () => {
    // The direct descendant of the Education bug. The list is ordered defaults-first then
    // alphabetically, so `categories[0]` filed every unresolved expense under Entertainment here
    // and under Education with the real seed. Refusing the write is the honest outcome.
    const withoutOther = CATEGORIES.filter((c) => c.name !== "Other Expense");

    expect(resolveTileCategory(tile({ description: "misc thing" }), withoutOther)).toBeNull();
  });

  it("does not pull a fare home into Housing or Home Supplies", () => {
    // Pinned separately, exactly as `quick-keyboard.test.ts` pins it: `matchCategory` checks
    // category *names* before keyword hints, and the word "home" appears in two category names.
    const result = resolveTileCategory(tile({ description: "fare home (UV)" }), CATEGORIES);

    expect(result?.categoryName).toBe("Transportation");
  });

  it("keeps the three existing fares filing where they always did", () => {
    // The property `quick-keyboard.test.ts` guarantees at compile time for QUICK_FARES, asserted
    // here for the same three descriptions once they are rows instead of a literal.
    for (const description of ["fare to office", "fare home (UV)", "fare home (UV + jeep)"]) {
      expect(resolveTileCategory(tile({ description }), CATEGORIES)?.categoryName).toBe(
        "Transportation"
      );
    }
  });

  it("resolves an income tile against income categories only", () => {
    const categories = [...CATEGORIES, { id: "salary", name: "Salary", type: "INCOME" }];

    const result = resolveTileCategory(
      tile({ description: "monthly pay", type: "INCOME" }),
      categories
    );

    expect(result?.categoryId).toBe("salary");
  });
});

describe("tileFallsBack", () => {
  it("is true whenever the tile is not filing where it was told to", () => {
    // What the editor shows before saving and the grid shows on every read, so a degraded tile is
    // visible rather than discovered in the category breakdown a month later.
    expect(tileFallsBack({ categoryId: "x", categoryName: "X", via: "tile" })).toBe(false);
    expect(tileFallsBack({ categoryId: "x", categoryName: "X", via: "matched" })).toBe(true);
    expect(tileFallsBack({ categoryId: "x", categoryName: "X", via: "other" })).toBe(true);
    expect(tileFallsBack(null)).toBe(true);
  });
});

describe("nextSortOrder", () => {
  it("starts at the gap rather than at zero", () => {
    // Room to insert a tile *before* the first one without renumbering.
    expect(nextSortOrder([])).toBe(SORT_ORDER_GAP);
  });

  it("appends past the highest existing value", () => {
    expect(nextSortOrder([{ sortOrder: 10 }, { sortOrder: 30 }])).toBe(40);
  });

  it("appends past a gap-closed set rather than colliding", () => {
    // A reorder can leave values that are not multiples of the gap. Reading the max rather than
    // counting rows is what stops a new tile landing on top of an existing one.
    expect(nextSortOrder([{ sortOrder: 1 }, { sortOrder: 2 }, { sortOrder: 3 }])).toBe(13);
  });
});

describe("MAX_QUICK_TILES", () => {
  it("is four rows of a three-column grid", () => {
    expect(MAX_QUICK_TILES % 3).toBe(0);
  });
});
