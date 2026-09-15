import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalyticsData } from "@/types";

vi.mock("@/components/analytics/cash-flow-chart", () => ({ CashFlowChart: () => <div>cash flow chart</div> }));
vi.mock("@/components/analytics/category-breakdown-chart", () => ({ CategoryBreakdownChart: () => <div>category breakdown</div> }));
vi.mock("@/components/analytics/category-trends-chart", () => ({ CategoryTrendsChart: () => <div>category trends</div> }));
vi.mock("@/components/analytics/income-expenses-report", () => ({ IncomeExpensesReport: () => <div>income and expenses comparison</div> }));
vi.mock("@/components/analytics/label-breakdown-chart", () => ({ LabelBreakdownChart: () => <div>label breakdown</div> }));
vi.mock("@/components/analytics/spending-heatmap", () => ({ SpendingHeatmap: () => <div>spending heatmap</div> }));
vi.mock("@/components/analytics/top-transactions", () => ({ TopTransactions: () => <div>top transactions</div> }));

import { AnalyticsReports } from "@/components/analytics/analytics-reports";

const summary = { totalIncome: 0, totalExpenses: 0, netCashFlow: 0, transactionCount: 0 };
const data: AnalyticsData = {
  categoryBreakdown: [],
  allCategoryBreakdown: [],
  labelBreakdown: [],
  cashFlow: [],
  summary,
  previousSummary: summary,
  previousCategoryBreakdown: [],
  allPreviousCategoryBreakdown: [],
  periodLabel: "September 2026",
  previousPeriodLabel: "August 2026",
  statistics: {
    biggestExpense: null,
    biggestIncome: null,
    mostExpensiveDay: null,
    avgDailySpend: null,
    avgExpenseSize: null,
    avgIncomeSize: null,
    totalTransactions: 0,
    activeDays: 0,
    expenseDays: 0,
    totalDaysInPeriod: 30,
    spendingStreak: 0,
    mostUsedCategory: null,
    mostExpensiveCategory: null,
    categoriesUsed: 0,
  },
  cashFlowSignals: {
    netCashFlow: 0,
    savingsRate: null,
    previousSavingsRate: null,
    savingsRateChange: null,
    expenseChange: null,
    incomeChange: null,
    expenseDays: 0,
    totalDaysInPeriod: 30,
    hasComparableData: false,
  },
  periodContext: {
    requestedFrom: "2026-09-01",
    requestedTo: "2026-09-30",
    effectiveTo: "2026-09-30",
    isPartial: false,
    daysElapsed: 30,
    daysInPeriod: 30,
    currentCoveragePct: 0,
    previousCoveragePct: 0,
    comparisonStatus: "no-previous-data",
    coverageThresholdPct: 60,
  },
  daily: [],
  categoryTrends: { series: [], points: [] },
  topTransactions: [],
};

describe("AnalyticsReports", () => {
  it("localizes the type filter to the three reports it controls", () => {
    const onTypeFilterChange = vi.fn();
    render(
      <AnalyticsReports
        data={data}
        currency="PHP"
        hideAmounts={false}
        dateRange={{ from: "2026-09-01", to: "2026-09-30" }}
        returnTo="period=monthly&type=EXPENSE&tab=reports"
        typeFilter="EXPENSE"
        onTypeFilterChange={onTypeFilterChange}
      />,
    );

    const breakdowns = screen.getByRole("region", { name: "Transaction breakdowns" });
    expect(within(breakdowns).getByRole("group", { name: "Filter transaction breakdowns by type" })).toBeDefined();
    expect(within(breakdowns).getByRole("heading", { name: "By Category" })).toBeDefined();
    expect(within(breakdowns).getByRole("heading", { name: "By Label" })).toBeDefined();
    expect(within(breakdowns).getByRole("heading", { name: "Top Transactions" })).toBeDefined();
    expect(within(breakdowns).getByRole("button", { name: "All" }).className).toContain("min-w-11");

    const expensePatterns = screen.getByRole("region", { name: "Expense patterns" });
    expect(within(expensePatterns).queryByRole("group", { name: /filter transaction breakdowns/i })).toBeNull();
    expect(within(expensePatterns).getByText("Expenses only")).toBeDefined();
    expect(within(expensePatterns).getByRole("heading", { name: "Category Trends" })).toBeDefined();
    expect(within(expensePatterns).getByRole("heading", { name: "Spending Heatmap" })).toBeDefined();

    const comparison = screen.getByRole("heading", { name: "Incomes & Expenses Report" });
    expect(breakdowns.contains(comparison)).toBe(false);
    expect(expensePatterns.contains(comparison)).toBe(false);
    expect(screen.getByText("All transaction types, current vs previous period by category")).toBeDefined();

    fireEvent.click(within(breakdowns).getByRole("button", { name: "Income" }));
    expect(onTypeFilterChange).toHaveBeenCalledWith("INCOME");
  });
});
