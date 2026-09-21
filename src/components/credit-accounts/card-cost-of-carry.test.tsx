import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CreditAccountView } from "@/hooks/use-credit-accounts";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => ({ hideAmounts: false }) }));

const { CardCostOfCarry } = await import("@/components/credit-accounts/card-cost-of-carry");

const account = (over: Partial<CreditAccountView> = {}): CreditAccountView =>
  ({
    id: "card_1",
    name: "BPI Gold",
    color: "#8B7E6A",
    creditLimit: null,
    statementDay: null,
    dueDay: null,
    apr: 36,
    minimumPaymentPct: 5,
    minimumPaymentFloor: 500,
    plannedPayment: 8000,
    openingBalance: 0,
    openingBalanceDate: "2026-01-01T00:00:00.000Z",
    isActive: true,
    billId: null,
    balance: 48000,
    availableCredit: null,
    utilization: null,
    totals: { purchases: 0, payments: 0, credits: 0 },
    ...over,
  }) as unknown as CreditAccountView;

describe("CardCostOfCarry", () => {
  /** A settled card has no payoff to project, so the whole block stays out of the way. */
  it("renders nothing for a card that owes nothing", () => {
    const { container } = render(
      <CardCostOfCarry account={account({ balance: 0 })} observedPayment={{ monthly: null, months: 0 }} onEdit={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  /**
   * Without an APR every column is withheld. The card must say what is missing and offer the way
   * to fix it, rather than showing a table of dashes.
   */
  it("asks for the APR instead of projecting without one", () => {
    render(
      <CardCostOfCarry account={account({ apr: null })} observedPayment={{ monthly: 5000, months: 6 }} onEdit={() => {}} />
    );
    expect(screen.getByText(/Add this card's APR/)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows all three bases when the terms are there", () => {
    render(
      <CardCostOfCarry account={account()} observedPayment={{ monthly: 5333, months: 6 }} onEdit={() => {}} />
    );
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("The minimum")).toBeDefined();
    expect(screen.getByText("Your average")).toBeDefined();
    expect(screen.getByText("Your plan")).toBeDefined();
  });

  /** A missing plan withholds its own row only: the minimum is still answerable. */
  it("withholds only the basis whose input is missing", () => {
    render(
      <CardCostOfCarry
        account={account({ plannedPayment: null })}
        observedPayment={{ monthly: null, months: 0 }}
        onEdit={() => {}}
      />
    );
    expect(screen.getByText("No planned payment set")).toBeDefined();
    expect(screen.getByText("Too few payments logged yet")).toBeDefined();
  });

  /**
   * The headline case. A percentage-only minimum that never gets ahead of the interest never
   * clears, and saying so plainly is the entire point of the card. At 36% APR the break-even is
   * 2.91% of the statement balance, so 2% never moves.
   */
  it("says a minimum that never beats the interest never clears", () => {
    render(
      <CardCostOfCarry
        account={account({ minimumPaymentPct: 2, minimumPaymentFloor: null, plannedPayment: null })}
        observedPayment={{ monthly: null, months: 0 }}
        onEdit={() => {}}
      />
    );
    expect(screen.getByText("Never clears")).toBeDefined();
  });

  /** The span shown is the one measured, not the window's width. */
  it("names how many months the average actually covers", () => {
    render(
      <CardCostOfCarry account={account()} observedPayment={{ monthly: 4000, months: 2 }} onEdit={() => {}} />
    );
    expect(screen.getByText(/over 2 months/)).toBeDefined();
  });

  it("labels itself a projection", () => {
    render(<CardCostOfCarry account={account()} observedPayment={{ monthly: 5333, months: 6 }} onEdit={() => {}} />);
    expect(screen.getByText(/A projection, not a promise/)).toBeDefined();
  });
});
