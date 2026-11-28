import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  describe("long-press", () => {
    afterEach(() => vi.useRealTimers());

    it("fires from the row body", () => {
      vi.useFakeTimers();
      const { container, props } = renderRow();
      fireEvent.pointerDown(row(container), { pointerType: "touch" });
      vi.advanceTimersByTime(450);
      expect(props.onLongPress).toHaveBeenCalledTimes(1);
    });

    it("does not fire while holding the checkbox, which would select then deselect the row", () => {
      vi.useFakeTimers();
      const { props } = renderRow({ selectMode: true });
      fireEvent.pointerDown(screen.getByRole("checkbox"), { pointerType: "touch" });
      vi.advanceTimersByTime(450);
      expect(props.onLongPress).not.toHaveBeenCalled();
    });
  });

  describe("label pills in select mode", () => {
    const labelled = {
      ...tx,
      labels: [{ id: "tl_1", labelId: "l_1", label: { id: "l_1", name: "Work Budget", color: "#D9643A" } }],
    } as unknown as TransactionWithCategory;

    it("lets a pill tap reach the row, so it selects instead of revealing a remove button", () => {
      const { props } = renderRow({ tx: labelled, selectMode: true });
      fireEvent.click(screen.getByText("Work Budget"));
      expect(props.onToggle).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("keeps the remove affordance outside select mode", () => {
      const { props } = renderRow({ tx: labelled });
      fireEvent.click(screen.getByText("Work Budget"));
      expect(props.onOpen).not.toHaveBeenCalled();
    });
  });
});

describe("TransactionListRow without selection", () => {
  // The dashboard's recent rows: the same row, with nothing to select.
  const renderPlain = () => {
    const onOpen = vi.fn();
    const view = render(
      <TransactionListRow
        tx={tx}
        highlighted={false}
        hideAmounts={false}
        currency="PHP"
        timezoneOffset={-480}
        creditCardsEnabled
        receiptPhotosEnabled
        onOpen={onOpen}
        labelRemoval={{ onRemove: vi.fn(), removingLabelId: null, disabled: false }}
      />,
    );
    return { ...view, onOpen };
  };

  afterEach(() => vi.useRealTimers());

  it("renders no checkbox at any width", () => {
    const { container } = renderPlain();
    expect(container.querySelector("[data-row-checkbox]")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("opens the row on tap", () => {
    const { container, onOpen } = renderPlain();
    fireEvent.click(row(container));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("treats a long press as nothing special, so the following tap still opens the row", () => {
    vi.useFakeTimers();
    const { container, onOpen } = renderPlain();
    fireEvent.pointerDown(row(container), { pointerType: "touch" });
    vi.advanceTimersByTime(450);
    fireEvent.pointerUp(row(container), { pointerType: "touch" });
    fireEvent.click(row(container));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("leaves the text selectable, since holding a row selects nothing here", () => {
    const { container } = renderPlain();
    expect(row(container).className).not.toContain("select-none");
  });
});

describe("TransactionListRow feature flags, label removal and tints", () => {
  it("shows the card only when credit cards are enabled", () => {
    const carded = {
      ...tx,
      creditAccount: { id: "a1", name: "BPI Gold", color: "#123456" },
    } as unknown as TransactionWithCategory;
    const { unmount } = renderRow({ tx: carded, creditCardsEnabled: true });
    expect(screen.getAllByText("BPI Gold").length).toBeGreaterThan(0);
    unmount();
    renderRow({ tx: carded, creditCardsEnabled: false });
    expect(screen.queryAllByText("BPI Gold")).toHaveLength(0);
    expect(screen.queryAllByLabelText("Paid with BPI Gold")).toHaveLength(0);
  });

  it("hides the photo marker when receipt photos are disabled", () => {
    renderRow({ receiptPhotosEnabled: false });
    expect(screen.queryByText("Photo")).toBeNull();
    expect(screen.queryAllByLabelText(/photo/i)).toHaveLength(0);
  });

  it("removes a label without opening the row", () => {
    const labelled = {
      ...tx,
      labels: [{ id: "tl_1", labelId: "l_1", label: { id: "l_1", name: "Work Budget", color: "#D9643A" } }],
    } as unknown as TransactionWithCategory;
    const { props } = renderRow({ tx: labelled });
    fireEvent.click(screen.getByText("Work Budget")); // reveals the X
    fireEvent.click(screen.getByRole("button"));
    expect(props.labelRemoval.onRemove).toHaveBeenCalledWith("tl_1", "l_1");
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("applies the highlighted and selected tints", () => {
    const plain = renderRow();
    expect(row(plain.container).className).not.toContain("ring-1");
    expect(row(plain.container).className).not.toContain("bg-amber-light/20");
    plain.unmount();
    const highlighted = renderRow({ highlighted: true });
    expect(row(highlighted.container).className).toContain("ring-1");
    highlighted.unmount();
    const selected = renderRow({ isSelected: true });
    expect(row(selected.container).className).toContain("bg-amber-light/20");
  });
});
