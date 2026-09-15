import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardLedgerList, mergeLedger } from "@/components/credit-accounts/card-ledger-list";
import type { CardPurchaseView, CreditPaymentView } from "@/hooks/use-credit-accounts";

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

const purchase = (over: Partial<CardPurchaseView> = {}): CardPurchaseView => ({
  id: "tx-1",
  amount: 1111,
  description: "Google One",
  date: "2026-08-25T04:00:00.000Z",
  categoryId: "cat-subs",
  category: { id: "cat-subs", name: "Subscriptions", icon: "Film", color: "#FF6B6B" },
  labels: [{ labelId: "label-1", label: { name: "Personal", color: "#8B6FC0" } }],
  ...over,
});

const payment = (over: Partial<CreditPaymentView> = {}): CreditPaymentView => ({
  id: "pay-1",
  kind: "PAYMENT",
  amount: 5000,
  description: "BPI app",
  date: "2026-09-05T02:00:00.000Z",
  ...over,
});

describe("mergeLedger", () => {
  it("interleaves purchases and payments newest first", () => {
    const entries = mergeLedger(
      [purchase({ id: "old", date: "2026-08-01T04:00:00.000Z" }), purchase({ id: "new", date: "2026-09-10T04:00:00.000Z" })],
      [payment()]
    );

    expect(entries.map((e) => (e.type === "purchase" ? e.purchase.id : e.payment.id))).toEqual([
      "new",
      "pay-1",
      "old",
    ]);
  });
});

describe("CardLedgerList", () => {
  const renderList = (purchases: CardPurchaseView[], payments: CreditPaymentView[], onEditPayment = vi.fn()) =>
    render(
      <CardLedgerList purchases={purchases} payments={payments} onEditPayment={onEditPayment} onDeletePayment={() => {}} />
    );

  it("links a purchase to its transaction and shows its category and labels", () => {
    renderList([purchase()], []);

    expect(screen.getByRole("link").getAttribute("href")).toBe("/transactions?highlight=tx-1");
    expect(screen.getByText("Aug 25 · Subscriptions · Personal")).toBeTruthy();
  });

  it("edits a payment in place, since it is not a transaction", () => {
    const onEditPayment = vi.fn();
    renderList([], [payment()], onEditPayment);

    fireEvent.click(screen.getByRole("button", { name: "Edit BPI app" }));

    expect(onEditPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "pay-1" }));
    expect(screen.getByText("-₱5,000.00")).toBeTruthy();
  });

  it("names a refund as one", () => {
    renderList([], [payment({ kind: "CREDIT", description: "" })]);

    expect(screen.getByText("Refund")).toBeTruthy();
  });

  it("says so when the month is empty", () => {
    renderList([], []);

    expect(screen.getByText("Nothing on this card this month.")).toBeTruthy();
  });
});
