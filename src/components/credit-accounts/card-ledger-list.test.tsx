import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardLedgerList, mergeLedger } from "@/components/credit-accounts/card-ledger-list";
import type { CardPaymentView, CreditChargeView } from "@/hooks/use-credit-accounts";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => ({ hideAmounts: false }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const charge = (over: Partial<CreditChargeView> = {}): CreditChargeView => ({
  id: "charge-1",
  kind: "CHARGE",
  amount: 1424.15,
  description: "Anthropic* Claude Sub",
  date: "2026-08-24T16:00:00.000Z",
  originalAmount: 22.4,
  originalCurrency: "USD",
  categoryId: "cat-subs",
  category: { id: "cat-subs", name: "Subscriptions", icon: "Film", color: "#FF6B6B" },
  ...over,
});

const payment = (over: Partial<CardPaymentView> = {}): CardPaymentView => ({
  id: "tx-1",
  amount: 5000,
  description: "BPI payment",
  date: "2026-09-05T02:00:00.000Z",
  billId: null,
  ...over,
});

describe("mergeLedger", () => {
  it("interleaves charges and payments newest first", () => {
    const entries = mergeLedger(
      [charge({ id: "old", date: "2026-08-01T16:00:00.000Z" }), charge({ id: "new", date: "2026-09-10T16:00:00.000Z" })],
      [payment()]
    );

    expect(entries.map((e) => (e.type === "charge" ? e.charge.id : e.payment.id))).toEqual([
      "new",
      "tx-1",
      "old",
    ]);
  });
});

describe("CardLedgerList", () => {
  const renderList = (charges: CreditChargeView[], payments: CardPaymentView[]) =>
    render(
      <CardLedgerList charges={charges} payments={payments} onEditCharge={() => {}} onDeleteCharge={() => {}} />
    );

  it("dates a charge on the account's day and shows the foreign amount", () => {
    renderList([charge()], []);

    expect(screen.getByText(/Aug 25 · Subscriptions · USD 22\.40/)).toBeTruthy();
  });

  it("links a payment to its transaction, since that is where it is edited", () => {
    renderList([], [payment()]);

    expect(screen.getByRole("link").getAttribute("href")).toBe("/transactions?highlight=tx-1");
  });

  it("marks a refund as taking money off the card", () => {
    renderList([charge({ kind: "CREDIT", amount: 385, description: "Returned shoes" })], []);

    expect(screen.getByText(/Refund/)).toBeTruthy();
    expect(screen.getByText("-₱385.00")).toBeTruthy();
  });

  it("says so when the month is empty", () => {
    renderList([], []);

    expect(screen.getByText("Nothing on this card this month.")).toBeTruthy();
  });
});
