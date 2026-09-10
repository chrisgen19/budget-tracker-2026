import { describe, expect, it } from "vitest";
import { parseCategoryItemId } from "@/components/analytics/category-breakdown-chart";

describe("parseCategoryItemId", () => {
  it("splits the composite key /api/analytics builds the breakdown rows with", () => {
    // Sending the whole "id" as categoryId matches nothing and the drill-down
    // silently lands on an empty list, so this split is load-bearing.
    expect(parseCategoryItemId("clx123abc:EXPENSE")).toEqual({
      categoryId: "clx123abc",
      type: "EXPENSE",
    });
    expect(parseCategoryItemId("clx123abc:INCOME")).toEqual({
      categoryId: "clx123abc",
      type: "INCOME",
    });
  });

  it("leaves an id with no type suffix alone", () => {
    expect(parseCategoryItemId("clx123abc")).toEqual({ categoryId: "clx123abc" });
    expect(parseCategoryItemId("clx123abc:OTHER")).toEqual({ categoryId: "clx123abc:OTHER" });
  });

  it("splits on the last colon, not the first", () => {
    expect(parseCategoryItemId("odd:id:EXPENSE")).toEqual({
      categoryId: "odd:id",
      type: "EXPENSE",
    });
  });
});
