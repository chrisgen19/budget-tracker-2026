import { describe, expect, it } from "vitest";
import { computeCashFlowSignals } from "./analytics-signals";

const summary = (
  totalIncome: number,
  totalExpenses: number,
  transactionCount = 2,
) => ({
  totalIncome,
  totalExpenses,
  netCashFlow: totalIncome - totalExpenses,
  transactionCount,
});

describe("computeCashFlowSignals", () => {
  it("returns transparent rates and changes without producing a health grade", () => {
    const signals = computeCashFlowSignals(
      summary(1_000, 700),
      summary(800, 800),
      { expenseDays: 18, totalDaysInPeriod: 30 },
    );

    expect(signals).toEqual({
      netCashFlow: 300,
      savingsRate: 0.3,
      previousSavingsRate: 0,
      savingsRateChange: 0.3,
      expenseChange: -0.125,
      incomeChange: 0.25,
      expenseDays: 18,
      totalDaysInPeriod: 30,
      hasComparableData: true,
    });
    expect(signals).not.toHaveProperty("overallScore");
    expect(signals).not.toHaveProperty("diversification");
    expect(signals).not.toHaveProperty("consistency");
  });

  it("does not invent percentages from a zero comparison baseline", () => {
    const signals = computeCashFlowSignals(
      summary(500, 100),
      summary(0, 0),
      { expenseDays: 2, totalDaysInPeriod: 7 },
    );

    expect(signals.hasComparableData).toBe(true);
    expect(signals.previousSavingsRate).toBeNull();
    expect(signals.savingsRateChange).toBeNull();
    expect(signals.expenseChange).toBeNull();
    expect(signals.incomeChange).toBeNull();
  });

  it("withholds comparisons when the previous period has no transactions", () => {
    const signals = computeCashFlowSignals(
      summary(1_000, 600),
      summary(0, 0, 0),
      { expenseDays: 5, totalDaysInPeriod: 14 },
    );

    expect(signals.hasComparableData).toBe(false);
    expect(signals.previousSavingsRate).toBeNull();
    expect(signals.savingsRateChange).toBeNull();
    expect(signals.expenseChange).toBeNull();
    expect(signals.incomeChange).toBeNull();
  });

  it("withholds deltas when the coverage gate rejects the comparison", () => {
    const signals = computeCashFlowSignals(
      summary(1_000, 600),
      summary(800, 500),
      { expenseDays: 5, totalDaysInPeriod: 14 },
      false,
    );

    expect(signals.hasComparableData).toBe(false);
    expect(signals.expenseChange).toBeNull();
    expect(signals.incomeChange).toBeNull();
    expect(signals.savingsRateChange).toBeNull();
  });

  it("reports no savings rate when no income is logged", () => {
    const signals = computeCashFlowSignals(
      summary(0, 250),
      summary(1_000, 750),
      { expenseDays: 3, totalDaysInPeriod: 7 },
    );

    expect(signals.savingsRate).toBeNull();
    expect(signals.savingsRateChange).toBeNull();
    expect(signals.netCashFlow).toBe(-250);
  });
});
