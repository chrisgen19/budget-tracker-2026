import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CreditAccountCard,
  limitBarPercent,
  ordinalDay,
} from "@/components/credit-accounts/credit-account-card";
import type { CreditAccountView } from "@/hooks/use-credit-accounts";

const privacy = vi.hoisted(() => ({ hideAmounts: false }));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => privacy }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const account = (over: Partial<CreditAccountView> = {}): CreditAccountView => ({
  id: "card-1",
  name: "BPI Credit Card",
  color: "#5B6B8C",
  creditLimit: null,
  statementDay: null,
  dueDay: 5,
  openingBalance: 0,
  openingBalanceDate: "2026-08-31T16:00:00.000Z",
  isActive: true,
  billId: null,
  balance: 2295.28,
  availableCredit: null,
  utilization: null,
  apr: null,
  minimumPaymentPct: null,
  minimumPaymentFloor: null,
  plannedPayment: null,
  totals: { purchases: 7295.28, payments: 5000, credits: 0 },
  ...over,
});

describe("ordinalDay", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [31, "31st"],
  ])("%i is %s", (day, expected) => {
    expect(ordinalDay(day)).toBe(expected);
  });
});

describe("limitBarPercent", () => {
  it("is null with no utilization to draw", () => {
    expect(limitBarPercent(null)).toBeNull();
    expect(limitBarPercent(undefined)).toBeNull();
  });

  /** The bar clamps because it cannot draw past full or below empty. The figure does not. */
  it("clamps the bar at both ends", () => {
    expect(limitBarPercent(120)).toBe(100);
    expect(limitBarPercent(-5)).toBe(0);
  });

  it("rounds to a whole percent for the width", () => {
    expect(limitBarPercent(38.3)).toBe(38);
  });
});

describe("CreditAccountCard utilization", () => {
  /**
   * The list and the detail page must print the same number. They did not: this page had its own
   * clamped, integer-rounded implementation, so a card over its limit read "100%" here and "108.3%"
   * there, and a card holding a credit read "0%" here and a negative there. Both are exactly the
   * readings `.claude/rules/cards.md` says must survive.
   */
  it("prints the server's figure unclamped when the card is over its limit", () => {
    privacy.hideAmounts = false;
    render(<CreditAccountCard account={account({ creditLimit: 48000, balance: 52000, utilization: 108.3 })} />);
    expect(screen.getByText(/108\.3% of/)).toBeDefined();
  });

  it("prints a negative when the card holds a credit", () => {
    privacy.hideAmounts = false;
    render(<CreditAccountCard account={account({ creditLimit: 48000, balance: -500, utilization: -1 })} />);
    expect(screen.getByText(/-1% of/)).toBeDefined();
  });

  /** The bar is the one thing that clamps, because it cannot be drawn past full. */
  it("still clamps the bar itself to full", () => {
    privacy.hideAmounts = false;
    render(<CreditAccountCard account={account({ creditLimit: 48000, balance: 52000, utilization: 108.3 })} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("shows no bar at all without a utilization", () => {
    privacy.hideAmounts = false;
    render(<CreditAccountCard account={account({ creditLimit: 48000, utilization: null })} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("CreditAccountCard", () => {
  it("links to the card and shows what is owed", () => {
    privacy.hideAmounts = false;
    render(<CreditAccountCard account={account()} />);

    expect(screen.getByRole("link").getAttribute("href")).toBe("/cards/card-1");
    expect(screen.getByText("You owe")).toBeTruthy();
    expect(screen.getByText("₱2,295.28")).toBeTruthy();
    expect(screen.getByText("Due on the 5th")).toBeTruthy();
  });

  it("reads an overpayment as a credit, not as debt", () => {
    privacy.hideAmounts = false;
    render(<CreditAccountCard account={account({ balance: -50 })} />);

    expect(screen.getByText("Credit on card")).toBeTruthy();
    expect(screen.getByText("₱50.00")).toBeTruthy();
  });

  it("masks the balance when amounts are hidden", () => {
    privacy.hideAmounts = true;
    render(<CreditAccountCard account={account()} />);

    expect(screen.queryByText("₱2,295.28")).toBeNull();
    expect(screen.getByText("₱ ••••••")).toBeTruthy();
  });
});
