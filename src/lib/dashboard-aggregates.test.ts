import { describe, expect, it } from "vitest";
import { buildCategoryBreakdown, buildMonthlyTrend } from "@/lib/dashboard-aggregates";

const cat = (name: string) => ({ name, color: "#111111", icon: "tag" });
const toKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

describe("buildCategoryBreakdown", () => {
  it("counts only EXPENSE rows", () => {
    const result = buildCategoryBreakdown(
      [
        { categoryId: "c1", type: "EXPENSE", amount: 100, category: cat("Food") },
        { categoryId: "c1", type: "EXPENSE", amount: 50, category: cat("Food") },
        { categoryId: "c1", type: "INCOME", amount: 999, category: cat("Food") },
      ],
      150
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "c1",
      type: "EXPENSE",
      amount: 150,
      transactionCount: 2,
      percentage: 100,
    });
  });

  it("sorts by amount descending and rounds percentage", () => {
    const result = buildCategoryBreakdown(
      [
        { categoryId: "c2", type: "EXPENSE", amount: 100, category: cat("Fun") },
        { categoryId: "c1", type: "EXPENSE", amount: 300, category: cat("Food") },
      ],
      400
    );
    expect(result.map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(result.map((r) => r.percentage)).toEqual([75, 25]);
  });

  it("gives 0% when totalExpenses is 0", () => {
    const result = buildCategoryBreakdown(
      [{ categoryId: "c1", type: "EXPENSE", amount: 0, category: cat("Food") }],
      0
    );
    expect(result[0].percentage).toBe(0);
  });
});

describe("buildMonthlyTrend", () => {
  const localNow = new Date(Date.UTC(2026, 10, 15));

  it("returns six months oldest first with monthKey", () => {
    const result = buildMonthlyTrend([], localNow, toKey);
    expect(result.map((r) => r.monthKey)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(result[5].month).toBe("Nov 2026");
  });

  it("counts both types in transactionCount", () => {
    const result = buildMonthlyTrend(
      [
        { type: "INCOME", amount: 500, date: new Date(Date.UTC(2026, 10, 2)) },
        { type: "EXPENSE", amount: 100, date: new Date(Date.UTC(2026, 10, 3)) },
        { type: "EXPENSE", amount: 50, date: new Date(Date.UTC(2026, 10, 4)) },
      ],
      localNow,
      toKey
    );
    expect(result[5]).toMatchObject({ income: 500, expenses: 150, transactionCount: 3 });
  });
});
