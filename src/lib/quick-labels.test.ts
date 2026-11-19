import { describe, expect, it } from "vitest";
import { isLabelCompatible, resolveQuickLabels } from "@/lib/quick-labels";
import type { LabelWithCountAndSchedules } from "@/types";

const label = (
  id: string,
  transactionCount = 0,
  applicableTo = "BOTH",
  categoryCounts: Record<string, number> = {},
): LabelWithCountAndSchedules => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  color: "#F5A623",
  applicableTo,
  userId: "user-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  _count: { transactions: transactionCount },
  schedules: [],
  categoryCounts,
});

describe("resolveQuickLabels", () => {
  it("puts pins first in pin order, then backfills by usage", () => {
    const labels = [label("alpha", 2), label("beta", 12), label("gamma", 8), label("delta", 1)];
    const ids = resolveQuickLabels(labels, ["delta", "alpha"]).map((l) => l.id);
    expect(ids).toEqual(["delta", "alpha", "beta", "gamma"]);
  });

  it("ranks usage in the category above overall usage, then name on ties", () => {
    const labels = [
      label("beta", 50),
      label("alpha", 1, "BOTH", { pet: 3 }),
      label("zeta", 0),
      label("eta", 0),
      label("omega", 0),
    ];
    const ids = resolveQuickLabels(labels, [], undefined, "pet").map((l) => l.id);
    expect(ids).toEqual(["alpha", "beta", "eta", "omega"]);
  });

  it("caps at four unless more are pinned", () => {
    const labels = ["a", "b", "c", "d", "e", "f"].map((id) => label(id));
    expect(resolveQuickLabels(labels, [])).toHaveLength(4);
    expect(resolveQuickLabels(labels, ["a", "b", "c", "d", "e"])).toHaveLength(5);
  });

  it("drops labels the transaction type excludes, pinned or not", () => {
    const labels = [label("salary", 9, "INCOME"), label("food", 1, "EXPENSE"), label("any")];
    const ids = resolveQuickLabels(labels, ["salary"], "EXPENSE").map((l) => l.id);
    expect(ids).toEqual(["food", "any"]);
  });
});

describe("isLabelCompatible", () => {
  it("accepts BOTH, a matching type, or no type at all", () => {
    expect(isLabelCompatible(label("x", 0, "BOTH"), "INCOME")).toBe(true);
    expect(isLabelCompatible(label("x", 0, "INCOME"), "INCOME")).toBe(true);
    expect(isLabelCompatible(label("x", 0, "INCOME"), "EXPENSE")).toBe(false);
    expect(isLabelCompatible(label("x", 0, "INCOME"))).toBe(true);
  });
});
