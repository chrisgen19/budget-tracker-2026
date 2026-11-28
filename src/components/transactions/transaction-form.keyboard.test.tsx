import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    note: () => screen.getByPlaceholderText("What was this for?"),
    form: () => screen.getByPlaceholderText("0.00").closest("form") as HTMLFormElement,
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

  it("leaves Enter alone and submits once a category is set", async () => {
    const { amount, form, onSubmit } = renderForm({ categoryId: "food" });
    fireEvent.change(amount, { target: { value: "250" } });

    // `fireEvent` returns false when a handler called preventDefault, so this is the
    // assertion that Enter was *not* intercepted. Named for what the value means.
    expect(fireEvent.keyDown(amount, { key: "Enter" })).toBe(true);

    // jsdom performs no implicit submission, so the submit the browser would do next is
    // driven here: the point is that the form still reaches `onSubmit` rather than an error.
    fireEvent.submit(form());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  // Both halves of the Enter handling are mobile-only. Off a phone there is no keyboard to
  // close, and intercepting Enter swallowed the "Category is required" message instead.
  it("still submits on Enter on desktop, so the error can appear", () => {
    const { amount } = renderForm({ keyboardOpen: false });

    act(() => amount.focus());

    expect(fireEvent.keyDown(amount, { key: "Enter" })).toBe(true);
    expect(amount.getAttribute("enterkeyhint")).toBeNull();
    expect(document.activeElement).toBe(amount);
  });

  // The amount hands the section the compact state when focus moves in without a click.
  // Only a click took it back, so focus leaving another way (a screen reader moving through
  // the form) left the footer hidden while typing the note.
  it("expands again when focus leaves the category section without a click", () => {
    const { amount, tile, note } = renderForm();

    act(() => amount.focus());
    act(() => tile().focus());
    expect(footerHidden()).toBe(true);

    act(() => note().focus());
    expect(footerHidden()).toBe(false);
  });

  // The gap belongs on the parent: `space-y-6` sets the child's margin-top through
  // `.space-y-6 > :not([hidden]) ~ :not([hidden])`, which outranks a `-mt-3` on the child
  // (0,3,0 against 0,1,0) and silently kept the full 24px. Measured at 24px in Chromium
  // before this fix and 12px after.
  it("tightens the form's own spacing while compact", () => {
    const { amount, form } = renderForm();

    expect(form().className).toContain("space-y-6");

    act(() => amount.focus());

    expect(form().className).toContain("space-y-3");
    expect(form().className).not.toContain("space-y-6");
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
