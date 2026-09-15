import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetPerformanceData } from "@/types";

const mocks = vi.hoisted(() => ({
  useBudgetPerformance: vi.fn(),
  useCategoriesQuery: vi.fn(),
  saveBudgetPlan: vi.fn(),
}));

vi.mock("@/hooks/use-budget-plan", () => ({
  useBudgetPerformance: mocks.useBudgetPerformance,
  useSaveBudgetPlan: () => ({ isPending: false, mutateAsync: mocks.saveBudgetPlan }),
}));
vi.mock("@/hooks/use-categories", () => ({ useCategoriesQuery: mocks.useCategoriesQuery }));

import { BudgetPerformance } from "@/components/analytics/budget-performance";

const data: BudgetPerformanceData = {
  month: "2026-09",
  periodLabel: "September 2026",
  progress: { isPartial: true, daysElapsed: 15, daysInMonth: 30, percentElapsed: 50, effectiveTo: "2026-09-15" },
  plan: {
    id: "plan-1",
    revision: 2,
    revisionCount: 2,
    createdAt: "2026-09-15T00:00:00Z",
    history: [
      { id: "plan-1", revision: 2, createdAt: "2026-09-15T00:00:00Z" },
      { id: "plan-0", revision: 1, createdAt: "2026-09-01T00:00:00Z" },
    ],
  },
  allocations: [{
    categoryId: "food",
    categoryName: "Food",
    categoryIcon: "UtensilsCrossed",
    categoryColor: "#123456",
    type: "EXPENSE",
    kind: "FLEXIBLE",
    planned: 6000,
    rolloverEnabled: true,
    rolloverCarryIn: 500,
    available: 6500,
    actual: 4000,
    remaining: 2500,
    varianceAmount: 2500,
    variancePct: 2500 / 6500,
    projectedActual: 8000,
    forecastToExceed: true,
    projectionBasis: "Current average daily spend across 15 elapsed calendar days.",
    rolloverCarryOut: 2500,
  }],
  totals: {
    plannedIncome: 20000,
    actualIncome: 19000,
    plannedExpenses: 6000,
    availableExpenses: 6500,
    actualExpenses: 4500,
    unbudgetedExpenses: 500,
    remainingExpenses: 2000,
    projectedExpenses: 8500,
    projectedVariance: -2000,
  },
  safeToSpend: {
    remainingFlexible: 2000,
    perDay: 125,
    perWeek: 875,
    untilNextIncome: 625,
    nextIncomeDate: "2026-09-20",
    daysUntilNextIncome: 5,
    basis: "Flexible budget basis.",
  },
  forecastStatus: "available",
  treatmentNotes: ["Transfers are not modeled."],
};

describe("BudgetPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveBudgetPlan.mockResolvedValue({ id: "plan-3", revision: 3 });
    mocks.useBudgetPerformance.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });
    mocks.useCategoriesQuery.mockReturnValue({
      data: [{
        id: "food",
        name: "Food",
        icon: "UtensilsCrossed",
        color: "#123456",
        type: "EXPENSE",
        isDefault: true,
        userId: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }],
      isLoading: false,
      isError: false,
    });
  });

  it("links every actual to the exact category and monthly ledger window", () => {
    render(<BudgetPerformance month="2026-09" timezoneOffset={-480} currency="PHP" hideAmounts={false} returnTo="period=monthly&tab=budget" />);

    const link = screen.getByRole("link", { name: /4,000/ });
    expect(link.getAttribute("href")).toContain("categoryId=food");
    expect(link.getAttribute("href")).toContain("from=2026-09-01");
    expect(link.getAttribute("href")).toContain("to=2026-09-15");
  });

  it("masks every rendered monetary amount when privacy mode is on", () => {
    const { container } = render(<BudgetPerformance month="2026-09" timezoneOffset={-480} currency="PHP" hideAmounts returnTo="period=monthly&tab=budget" />);

    expect(container.textContent).not.toMatch(/4,000|6,000|6,500|2,500|8,000|19,000|20,000/);
    expect(container.textContent).toContain("••••••");
  });

  it("edits and saves the month's complete allocation snapshot", async () => {
    render(<BudgetPerformance month="2026-09" timezoneOffset={-480} currency="PHP" hideAmounts={false} returnTo="period=monthly&tab=budget" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));
    fireEvent.change(screen.getByLabelText("Food"), { target: { value: "7000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));

    await waitFor(() => expect(mocks.saveBudgetPlan).toHaveBeenCalledWith({
      allocations: [{ categoryId: "food", amount: 7000, kind: "FLEXIBLE", rolloverEnabled: true }],
    }));
  });

  it("masks plan editor inputs in privacy mode", () => {
    render(<BudgetPerformance month="2026-09" timezoneOffset={-480} currency="PHP" hideAmounts returnTo="period=monthly&tab=budget" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit plan" }));

    expect(screen.getByLabelText("Food").getAttribute("type")).toBe("password");
  });
});
