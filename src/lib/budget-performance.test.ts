import { describe, expect, it } from "vitest";
import {
  buildBudgetAllocations,
  buildBudgetTotals,
  buildSafeToSpend,
  budgetForecastStatus,
  calculateRolloverCarryIn,
} from "@/lib/budget-performance";

const progress = { isPartial: true, daysElapsed: 15, daysInMonth: 30 };
const sources = [
  {
    categoryId: "rent",
    categoryName: "Rent",
    categoryIcon: "House",
    categoryColor: "#000",
    type: "EXPENSE" as const,
    kind: "FIXED" as const,
    planned: 10_000,
    rolloverEnabled: false,
    rolloverCarryIn: 0,
  },
  {
    categoryId: "food",
    categoryName: "Food",
    categoryIcon: "Utensils",
    categoryColor: "#111",
    type: "EXPENSE" as const,
    kind: "FLEXIBLE" as const,
    planned: 6_000,
    rolloverEnabled: true,
    rolloverCarryIn: 500,
  },
];

describe("budget performance", () => {
  it("paces flexible spending but does not multiply fixed costs", () => {
    const rows = buildBudgetAllocations(sources, new Map([["rent", 10_000], ["food", 4_000]]), progress);

    expect(rows[0]).toMatchObject({ projectedActual: 10_000, forecastToExceed: false });
    expect(rows[1]).toMatchObject({ available: 6_500, remaining: 2_500, projectedActual: 8_000, forecastToExceed: true, rolloverCarryOut: 2_500 });
  });

  it("treats income above plan as a favorable positive variance", () => {
    const [row] = buildBudgetAllocations([{
      categoryId: "salary",
      categoryName: "Salary",
      categoryIcon: "Banknote",
      categoryColor: "#222",
      type: "INCOME",
      kind: "INCOME",
      planned: 20_000,
      rolloverEnabled: false,
      rolloverCarryIn: 0,
    }], new Map([["salary", 22_000]]), progress);

    expect(row).toMatchObject({ remaining: -2_000, varianceAmount: 2_000, variancePct: 0.1 });
  });

  it("reconciles total actuals and reports unbudgeted expenses", () => {
    const rows = buildBudgetAllocations(sources, new Map([["rent", 10_000], ["food", 4_000]]), progress);
    expect(buildBudgetTotals(rows, 20_000, 15_000, progress)).toMatchObject({
      availableExpenses: 16_500,
      actualExpenses: 15_000,
      unbudgetedExpenses: 1_000,
      remainingExpenses: 1_500,
      projectedExpenses: 20_000,
      projectedVariance: -3_500,
    });
  });

  it("reserves fixed and savings money when calculating safe flexible spend", () => {
    const rows = buildBudgetAllocations(sources, new Map([["rent", 10_000], ["food", 4_000]]), progress);
    const safe = buildSafeToSpend(rows, 1_000, progress, "2026-09-15", "2026-09-20");

    expect(safe).toMatchObject({
      remainingFlexible: 1_500,
      perDay: 93.75,
      perWeek: 656.25,
      untilNextIncome: 468.75,
      daysUntilNextIncome: 5,
    });
  });

  it("names future and no-activity forecast states", () => {
    expect(budgetForecastStatus({ ...progress, daysElapsed: 0 }, 0)).toBe("not-started");
    expect(budgetForecastStatus(progress, 0)).toBe("no-activity");
    expect(budgetForecastStatus(progress, 1)).toBe("available");
  });

  it("carries both underspend and overspend only from a rollover-enabled prior plan", () => {
    expect(calculateRolloverCarryIn({ planned: 5_000, rolloverCarryIn: 500, rolloverEnabled: true }, 4_000)).toBe(1_500);
    expect(calculateRolloverCarryIn({ planned: 5_000, rolloverCarryIn: 0, rolloverEnabled: true }, 6_000)).toBe(-1_000);
    expect(calculateRolloverCarryIn({ planned: 5_000, rolloverCarryIn: 500, rolloverEnabled: false }, 4_000)).toBe(0);
  });
});
