import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import {
  KEYBOARD_REVEAL_UNTIL_ATTR,
  ModalKeyboardContext,
} from "@/components/ui/modal-keyboard-context";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: {
      currency: "PHP",
      timezoneOffset: -480,
      // Off, so every test here focuses the amount itself and the focused state is never
      // an accident of the mount.
      transactionAmountAutofocus: false,
    },
  }),
}));

vi.mock("@/hooks/use-categories", () => {
  // Built once: the real hook is a per-type React Query cache with a stable `data` identity,
  // and a fresh array per render would re-run the form's category effects forever.
  const food = { id: "food", name: "Food", type: "EXPENSE", icon: "utensils", color: "#000000" };
  const byType = {
    EXPENSE: [food],
    INCOME: [{ id: "salary", name: "Salary", type: "INCOME", icon: "wallet", color: "#000000" }],
  };
  const quickPreferences = { quickExpenseCategories: ["food"], quickIncomeCategories: [] };
  return {
    useCategoriesQuery: (type?: "INCOME" | "EXPENSE") => ({
      data: type ? byType[type] : [...byType.EXPENSE, ...byType.INCOME],
      isLoading: false,
    }),
    useQuickPreferencesQuery: () => ({ data: quickPreferences }),
  };
});

vi.mock("@/hooks/use-labels", () => {
  const data: unknown[] = [];
  return { useLabelsQuery: () => ({ data }) };
});
vi.mock("@/hooks/use-scheduled-label", () => ({
  useScheduledLabel: () => ({ scheduledLabelId: null }),
}));
vi.mock("@/components/transactions/label-picker", () => ({ LabelPicker: () => null }));

const renderForm = (
  { keyboardOpen = true, categoryId }: { keyboardOpen?: boolean; categoryId?: string } = {},
  onSubmit = vi.fn(() => Promise.resolve()),
) => {
  render(
    <ModalKeyboardContext.Provider value={keyboardOpen}>
      <TransactionForm
        initialData={categoryId ? { categoryId } : undefined}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    </ModalKeyboardContext.Provider>,
  );
  return {
    amount: screen.getByPlaceholderText("0.00") as HTMLInputElement,
    footer: () => screen.getByTestId("form-footer"),
    tile: () => screen.getByRole("button", { name: /Food/ }),
    onSubmit,
  };
};

/** `.focus()` rather than `fireEvent.focus`: only the real call moves `document.activeElement`,
 * which is what the blur-on-tile path checks. `act` flushes the state it sets. */
const focusAmount = (amount: HTMLInputElement) => act(() => amount.focus());

const footerHidden = () => screen.getByTestId("form-footer").classList.contains("hidden");

describe("TransactionForm while the keyboard is up", () => {
  // Add cannot succeed without a category, so the footer is not worth the height it costs:
  // the tiles move up under the amount instead, where the keyboard leaves room for them.
  it("hides the footer while the amount is focused with no category picked", () => {
    const { amount } = renderForm();

    expect(footerHidden()).toBe(false);
    focusAmount(amount);
    expect(footerHidden()).toBe(true);
  });

  it("keeps the footer when a category is already set", () => {
    const { amount } = renderForm({ categoryId: "food" });

    focusAmount(amount);
    expect(footerHidden()).toBe(false);
  });

  it("keeps the footer with the keyboard down", () => {
    const { amount } = renderForm({ keyboardOpen: false });

    focusAmount(amount);
    expect(footerHidden()).toBe(false);
  });

  it("brings the footer back when a quick tile is tapped", () => {
    const { amount, tile } = renderForm();

    focusAmount(amount);
    expect(footerHidden()).toBe(true);

    fireEvent.click(tile());

    expect(footerHidden()).toBe(false);
    expect(document.activeElement).not.toBe(amount);
  });

  // A tile taking focus on its way to a click must not expand the layout mid-tap: the tiles
  // would move out from under the finger and the click could land on nothing.
  it("stays compact when focus moves into the category section", () => {
    const { amount, tile } = renderForm();

    focusAmount(amount);
    fireEvent.blur(amount, { relatedTarget: tile() });

    expect(footerHidden()).toBe(true);
  });

  it("expands again when focus leaves the form", () => {
    const { amount } = renderForm();

    focusAmount(amount);
    fireEvent.blur(amount, { relatedTarget: null });

    expect(footerHidden()).toBe(false);
  });

  // Enter with no category could only submit into "Category is required", so it closes the
  // keyboard and shows the whole form instead.
  it("closes the keyboard on Enter instead of submitting without a category", () => {
    const { amount, onSubmit } = renderForm();

    focusAmount(amount);
    fireEvent.keyDown(amount, { key: "Enter" });

    expect(footerHidden()).toBe(false);
    expect(document.activeElement).not.toBe(amount);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits on Enter once a category is set", () => {
    const { amount } = renderForm({ categoryId: "food" });
    const prevented = fireEvent.keyDown(amount, { key: "Enter" });

    // `fireEvent` returns false when a handler called preventDefault.
    expect(prevented).toBe(true);
  });

  // Centring the amount would leave the tiles under the keyboard. The sheet reads this
  // attribute and scrolls the tiles into view instead.
  it("points the sheet at the quick tiles until a category is picked", () => {
    const { amount, tile } = renderForm();

    const target = amount.getAttribute(KEYBOARD_REVEAL_UNTIL_ATTR);
    expect(target).toBeTruthy();
    expect(document.getElementById(target as string)?.contains(tile())).toBe(true);

    fireEvent.click(tile());
    expect(amount.getAttribute(KEYBOARD_REVEAL_UNTIL_ATTR)).toBeNull();
  });
});
