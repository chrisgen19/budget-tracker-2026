import { describe, expect, it } from "vitest";
import { MAX_QUICK_CATEGORIES, resolveQuickCategories } from "@/lib/quick-categories";

/**
 * `users.quick_expense_categories` is a plain `String[]`, so deleting a category leaves its id
 * stranded there. The picker counts what it is given against MAX_QUICK_CATEGORIES, so a stored
 * list of four containing one dead id used to make it believe it was full: three tiles rendered
 * as selected, every other tile was disabled, and the fourth slot became unreachable.
 */

const cat = (id: string) => ({ id, name: id });

const ALL = [cat("food"), cat("transport"), cat("shopping"), cat("housing"), cat("pet")];

describe("resolveQuickCategories", () => {
  it("does not let a deleted category occupy a picker slot", () => {
    const { display, selectedIds } = resolveQuickCategories(
      ["food", "transport", "deleted-id", "shopping"],
      ALL
    );

    // The row shows three tiles and an empty slot...
    expect(display.map((c) => c.id)).toEqual(["food", "transport", "shopping"]);
    // ...and the picker must agree, or that slot can never be filled.
    expect(selectedIds).toEqual(["food", "transport", "shopping"]);
    expect(selectedIds.length).toBeLessThan(MAX_QUICK_CATEGORIES);
  });

  it("preserves the stored order", () => {
    const { display } = resolveQuickCategories(["shopping", "food"], ALL);
    expect(display.map((c) => c.id)).toEqual(["shopping", "food"]);
  });

  it("keeps a full, valid selection full", () => {
    const stored = ["food", "transport", "shopping", "housing"];
    const { selectedIds } = resolveQuickCategories(stored, ALL);
    expect(selectedIds).toEqual(stored);
  });

  it("falls back to the first few categories for a user who has picked none", () => {
    const { display } = resolveQuickCategories([], ALL);
    expect(display).toEqual(ALL.slice(0, MAX_QUICK_CATEGORIES));
  });

  it("does not feed the display fallback back to the picker", () => {
    // Otherwise a first-time picker opens already at its limit, which is the same dead end.
    expect(resolveQuickCategories([], ALL).selectedIds).toEqual([]);
  });

  it("falls back when every stored id is dead", () => {
    const { display, selectedIds } = resolveQuickCategories(["gone", "also-gone"], ALL);
    expect(display).toEqual(ALL.slice(0, MAX_QUICK_CATEGORIES));
    expect(selectedIds).toEqual([]);
  });

  it("drops a duplicate that no longer resolves", () => {
    // array_remove strips every occurrence; nothing else should reintroduce one.
    const { selectedIds } = resolveQuickCategories(["food", "gone", "gone"], ALL);
    expect(selectedIds).toEqual(["food"]);
  });
});
