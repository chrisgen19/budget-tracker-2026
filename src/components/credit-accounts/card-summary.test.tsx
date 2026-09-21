import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CreditAccountView, LedgerTotalsView } from "@/hooks/use-credit-accounts";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));
vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({ hideAmounts: false }),
}));

const { CardSummary } = await import("@/components/credit-accounts/card-summary");

const account = (balance: number): CreditAccountView =>
  ({
    id: "card_1",
    name: "BPI Gold",
    color: "#8B7E6A",
    creditLimit: null,
    statementDay: null,
    dueDay: null,
    openingBalance: 0,
    openingBalanceDate: "2026-01-01T00:00:00.000Z",
    isActive: true,
    billId: null,
    balance,
    availableCredit: null,
    utilization: null,
    apr: null,
    minimumPaymentPct: null,
    minimumPaymentFloor: null,
    plannedPayment: null,
    totals: { purchases: 0, payments: 0, credits: 0 },
  }) as unknown as CreditAccountView;

const totals: LedgerTotalsView = { purchases: 0, payments: 0, credits: 0 };

describe("CardSummary interest", () => {
  /**
   * The distinction the whole feature rests on. A card that has never had interest logged is not a
   * card that was charged none this month: the first means the derived balance is drifting below
   * the statement, the second is a real zero. Rendering both as "None" loses it, and the notice
   * below only appears for a card in debt, so on a settled card nothing else carries it.
   */
  it("says 'Not tracked' when nothing has ever been logged", () => {
    render(
      <CardSummary account={account(0)} monthTotals={totals} interest={{ period: 0, everLogged: false }} />
    );
    expect(screen.getByText("Not tracked")).toBeDefined();
  });

  it("says 'None' for a month that genuinely had none", () => {
    render(
      <CardSummary account={account(0)} monthTotals={totals} interest={{ period: 0, everLogged: true }} />
    );
    expect(screen.getByText("None")).toBeDefined();
    expect(screen.queryByText("Not tracked")).toBeNull();
  });

  it("shows what was charged", () => {
    render(
      <CardSummary account={account(5000)} monthTotals={totals} interest={{ period: 1446.5, everLogged: true }} />
    );
    expect(screen.getByText(/1,446\.5/)).toBeDefined();
  });

  /**
   * The `as unknown as` fixture hides a missing field from the type checker, so an absent
   * `utilization` rendered the string "undefined%" and three tests passed without noticing.
   */
  it("shows no utilization row when the server sent none", () => {
    render(
      <CardSummary account={account(0)} monthTotals={totals} interest={{ period: 0, everLogged: true }} />
    );
    expect(screen.queryByText("Utilization")).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  /** A card carrying a balance with no interest logged is the case the drift warning is for. */
  it("explains the drift only for a card still in debt", () => {
    const { unmount } = render(
      <CardSummary account={account(5000)} monthTotals={totals} interest={{ period: 0, everLogged: false }} />
    );
    expect(screen.getByText(/only counts purchases and payments/)).toBeDefined();
    unmount();

    render(
      <CardSummary account={account(0)} monthTotals={totals} interest={{ period: 0, everLogged: false }} />
    );
    expect(screen.queryByText(/only counts purchases and payments/)).toBeNull();
  });
});
