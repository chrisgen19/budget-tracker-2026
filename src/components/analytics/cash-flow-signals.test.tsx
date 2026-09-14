import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CashFlowSignals } from "./cash-flow-signals";

const signals = {
  netCashFlow: 300,
  savingsRate: 0.3,
  previousSavingsRate: 0.2,
  savingsRateChange: 0.1,
  expenseChange: -0.125,
  incomeChange: 0.25,
  expenseDays: 18,
  totalDaysInPeriod: 30,
  hasPreviousData: true,
};

describe("CashFlowSignals", () => {
  it("shows source metrics and their limits without presenting a grade", () => {
    render(
      <CashFlowSignals
        signals={signals}
        previousPeriodLabel="August 2026"
        currency="PHP"
        hideAmounts={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Cash Flow Signals" })).toBeTruthy();
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.getByText("18 / 30")).toBeTruthy();
    expect(screen.getByText("What these signals do not measure")).toBeTruthy();
    expect(screen.queryByText(/\/100/)).toBeNull();
    expect(screen.queryByText(/excellent|good|fair|critical|improving|declining/i)).toBeNull();
  });

  it("honors the app-wide amount privacy setting", () => {
    render(
      <CashFlowSignals
        signals={signals}
        previousPeriodLabel="August 2026"
        currency="PHP"
        hideAmounts
      />,
    );

    expect(screen.getByText("₱ ••••••")).toBeTruthy();
    expect(screen.queryByText(/300/)).toBeNull();
  });
});
