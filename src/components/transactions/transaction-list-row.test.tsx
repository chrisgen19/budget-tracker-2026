import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionListRow } from "@/components/transactions/transaction-list-row";
import type { TransactionWithCategory } from "@/types";

const tx = {
  id: "tx_1",
  description: "Starbucks Coffee",
  amount: 1125,
  type: "EXPENSE",
  date: "2026-11-27T09:23:00.000Z",
  category: { id: "c_1", name: "Food & Dining", color: "#E0674A", icon: "utensils" },
  labels: [],
  receiptGroupId: null,
  billId: null,
  createdVia: "APP",
  creditAccount: null,
  receiptPhotoId: "photo_1",
} as unknown as TransactionWithCategory;

const renderRow = (overrides: Partial<Parameters<typeof TransactionListRow>[0]> = {}) => {
  const props = {
    tx,
    isSelected: false,
    selectMode: false,
    highlighted: false,
    hideAmounts: false,
    currency: "PHP",
    timezoneOffset: -480,
    creditCardsEnabled: true,
    receiptPhotosEnabled: true,
    onToggle: vi.fn(),
    onOpen: vi.fn(),
    onLongPress: vi.fn(),
    labelRemoval: { onRemove: vi.fn(), removingLabelId: null, disabled: false },
    ...overrides,
  };
  const view = render(<TransactionListRow {...props} />);
  return { ...view, props };
};

const row = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-transaction-id="tx_1"]')!;

describe("TransactionListRow", () => {
  it("hides the checkbox on phones and opens the row on tap outside select mode", () => {
    const { container, props } = renderRow();
    expect(container.querySelector("[data-row-checkbox]")!.className).toBe("hidden sm:contents");
    fireEvent.click(row(container));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("shows the checkbox and toggles on tap in select mode", () => {
    const { container, props } = renderRow({ selectMode: true });
    expect(container.querySelector("[data-row-checkbox]")!.className).toBe("contents");
    fireEvent.click(row(container));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("masks the amount when amounts are hidden", () => {
    renderRow({ hideAmounts: true });
    expect(screen.getByText("••••")).toBeDefined();
    expect(screen.queryByText(/1,125/)).toBeNull();
  });

  it("renders the photo marker as a chip for desktop and an icon for phones", () => {
    const { container } = renderRow();
    const chip = screen.getByText("Photo");
    expect(chip.closest(".hidden.sm\\:contents")).not.toBeNull();
    const icon = screen.getByRole("img", { name: "Photo attached" });
    expect(icon.closest(".contents.sm\\:hidden")).not.toBeNull();
    expect(container.textContent).toContain("Food & Dining");
  });
});
