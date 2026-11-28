import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionRow } from "@/components/transactions/transaction-row";
import type { TransactionWithCategory } from "@/types";

function makeTx(overrides: Partial<TransactionWithCategory> = {}): TransactionWithCategory {
  return {
    id: "t1",
    description: "Lunch",
    amount: 123.45,
    type: "EXPENSE",
    date: new Date("2026-11-20T04:00:00.000Z"),
    receiptGroupId: null,
    billId: null,
    createdVia: "APP",
    receiptPhotoId: null,
    category: { id: "c1", name: "Food", icon: "utensils", color: "#aa5500" },
    labels: [],
    creditAccount: null,
    ...overrides,
  } as unknown as TransactionWithCategory;
}

const baseProps = {
  currency: "PHP",
  hideAmounts: false,
  timezoneOffset: -480,
  showCreditAccount: false,
  showReceiptPhoto: false,
  onSelect: () => {},
};

describe("TransactionRow", () => {
  it("shows the card name only when showCreditAccount", () => {
    const tx = makeTx({ creditAccount: { id: "a1", name: "BPI Gold", color: "#123456" } });
    const { rerender } = render(<TransactionRow {...baseProps} tx={tx} showCreditAccount />);
    expect(screen.getByText("BPI Gold")).toBeDefined();
    rerender(<TransactionRow {...baseProps} tx={tx} showCreditAccount={false} />);
    expect(screen.queryByText("BPI Gold")).toBeNull();
  });

  it("shows the Photo badge only when showReceiptPhoto", () => {
    const tx = makeTx({ receiptPhotoId: "p1" });
    const { rerender } = render(<TransactionRow {...baseProps} tx={tx} showReceiptPhoto />);
    expect(screen.getByText("Photo")).toBeDefined();
    rerender(<TransactionRow {...baseProps} tx={tx} showReceiptPhoto={false} />);
    expect(screen.queryByText("Photo")).toBeNull();
  });

  it("masks the amount when hideAmounts", () => {
    render(<TransactionRow {...baseProps} tx={makeTx()} hideAmounts />);
    expect(screen.getByText("••••")).toBeDefined();
    expect(screen.queryByText(/123\.45/)).toBeNull();
  });

  it("renders leading content", () => {
    render(<TransactionRow {...baseProps} tx={makeTx()} leading={<span>lead</span>} />);
    expect(screen.getByText("lead")).toBeDefined();
  });

  it("calls onSelect when the row is clicked", () => {
    const onSelect = vi.fn();
    render(<TransactionRow {...baseProps} tx={makeTx()} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Lunch"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("removing a label does not call onSelect", () => {
    const onSelect = vi.fn();
    const onRemoveLabel = vi.fn();
    const tx = makeTx({
      labels: [
        {
          id: "tl1",
          transactionId: "t1",
          labelId: "l1",
          label: { id: "l1", name: "Work", color: "#336699" },
        },
      ],
    } as unknown as Partial<TransactionWithCategory>);
    render(
      <TransactionRow {...baseProps} tx={tx} onSelect={onSelect} onRemoveLabel={onRemoveLabel} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onRemoveLabel).toHaveBeenCalledWith("l1");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
