import { describe, expect, it } from "vitest";
import {
  categoryRestrictionNarrowed,
  labelAllowsCategory,
  labelRowAllowsCategory,
  toAllowedCategoryIds,
} from "@/lib/label-category-matching";

describe("labelAllowsCategory", () => {
  // The whole backward-compatibility story in one assertion: every label that predates
  // `label_categories` has no rows there, and none of them may stop appearing.
  it("treats no linked categories as every category, not none", () => {
    expect(labelAllowsCategory([], "cat_transport")).toBe(true);
    expect(labelAllowsCategory(undefined, "cat_transport")).toBe(true);
  });

  it("allows a linked category", () => {
    expect(labelAllowsCategory(["cat_transport", "cat_food"], "cat_food")).toBe(true);
  });

  it("refuses a category the label is not linked to", () => {
    expect(labelAllowsCategory(["cat_transport"], "cat_shopping")).toBe(false);
  });

  // The picker renders before a category is chosen, and a quick-log tile may carry none at all.
  // Refusing on an absent category would empty the list at exactly the moment it is first read.
  it("allows anything when no category is known", () => {
    expect(labelAllowsCategory(["cat_transport"], null)).toBe(true);
    expect(labelAllowsCategory(["cat_transport"], undefined)).toBe(true);
    expect(labelAllowsCategory(["cat_transport"], "")).toBe(true);
  });
});

describe("toAllowedCategoryIds", () => {
  it("flattens the relation rows", () => {
    expect(toAllowedCategoryIds([{ categoryId: "a" }, { categoryId: "b" }])).toEqual(["a", "b"]);
  });

  it("treats an absent relation as unrestricted", () => {
    expect(toAllowedCategoryIds(undefined)).toEqual([]);
  });
});

describe("labelRowAllowsCategory", () => {
  it("reads the relation straight off a query result", () => {
    const label = { categories: [{ categoryId: "cat_transport" }] };
    expect(labelRowAllowsCategory(label, "cat_transport")).toBe(true);
    expect(labelRowAllowsCategory(label, "cat_food")).toBe(false);
  });

  // A row selected without the relation must not read as "restricted to nothing". Several read
  // paths deliberately omit it, and inverting the default there would hide every label.
  it("treats a row selected without the relation as unrestricted", () => {
    expect(labelRowAllowsCategory({}, "cat_food")).toBe(true);
  });
});

describe("categoryRestrictionNarrowed", () => {
  it("is true when the new set drops a category the old one allowed", () => {
    expect(categoryRestrictionNarrowed(["a", "b"], ["a"])).toBe(true);
    expect(categoryRestrictionNarrowed(["a"], ["b"])).toBe(true);
  });

  // The bug this replaced: adding a category changed the set, so an inequality test called it a
  // narrowing and offered to strip every grandfathered row outside the *wider* set.
  it("is false for a pure widening", () => {
    expect(categoryRestrictionNarrowed(["a"], ["a", "b"])).toBe(false);
  });

  it("is false when the set does not move, whatever the order", () => {
    expect(categoryRestrictionNarrowed(["a", "b"], ["b", "a"])).toBe(false);
  });

  // Empty means every category, so it cannot narrow -- and is the one thing everything narrows
  // away from.
  it("treats an empty new set as removing nothing", () => {
    expect(categoryRestrictionNarrowed(["a"], [])).toBe(false);
  });

  it("treats restricting a previously unrestricted label as narrowing", () => {
    expect(categoryRestrictionNarrowed([], ["a"])).toBe(true);
  });
});
