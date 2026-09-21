import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CreditAccountCard,
  limitUsedPercent,
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

describe("limitUsedPercent", () => {
  it("is null with no limit", () => {
    expect(limitUsedPercent(2295.28, null)).toBeNull();
  });

  it("clamps for the bar at both ends", () => {
    expect(limitUsedPercent(60000, 50000)).toBe(100);
    expect(limitUsedPercent(-100, 50000)).toBe(0);
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
