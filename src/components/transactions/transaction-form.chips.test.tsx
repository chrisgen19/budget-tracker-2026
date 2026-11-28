import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { ModalKeyboardContext } from "@/components/ui/modal-keyboard-context";
import type { TransactionInput } from "@/lib/validations";

const categoryMocks = vi.hoisted(() => ({
  useCategoriesQuery: vi.fn(),
  defaultImpl: (_type?: "INCOME" | "EXPENSE") => ({ data: [] as unknown[], isLoading: false }),
}));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: { currency: "PHP", timezoneOffset: -480, transactionAmountAutofocus: false },
  }),
}));

vi.mock("@/hooks/use-categories", () => {
  // Built once: a new array per call re-runs the form's category effects forever and hangs the worker.
  const make = (id: string, name: string, type: string) => ({
    id,
    name,
    type,
    icon: "utensils",
    color: "#000000",
  });
  const byType = {
    EXPENSE: [
      make("food", "Food", "EXPENSE"),
      make("transport", "Transport", "EXPENSE"),
      make("groceries", "Groceries", "EXPENSE"),
      make("shopping", "Shopping", "EXPENSE"),
      make("bills", "Bills", "EXPENSE"),
    ],
    INCOME: [make("salary", "Salary", "INCOME")],
  };
  const all = [...byType.EXPENSE, ...byType.INCOME];
  const quickPreferences = {
    quickExpenseCategories: ["food", "transport", "groceries", "shopping"],
    quickIncomeCategories: [],
  };
  categoryMocks.defaultImpl = (type) => ({ data: type ? byType[type] : all, isLoading: false });
  return {
    useCategoriesQuery: categoryMocks.useCategoriesQuery,
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
vi.mock("@/hooks/use-credit-accounts", () => {
  const cards: unknown[] = [];
  return { useCreditAccountsQuery: () => ({ data: cards, isLoading: false, isError: false }) };
});
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

let slotEl: HTMLDivElement;

beforeEach(() => {
  categoryMocks.useCategoriesQuery.mockImplementation(categoryMocks.defaultImpl);
  slotEl = document.createElement("div");
  document.body.appendChild(slotEl);
});

afterEach(() => {
  slotEl.remove();
});

const renderForm = ({
  keyboardOpen = true,
  withSlot = true,
  ...props
}: { keyboardOpen?: boolean; withSlot?: boolean } & Partial<Parameters<typeof TransactionForm>[0]> = {}) => {
  const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
  render(
    <ModalKeyboardContext.Provider value={{ keyboardOpen, footerSlot: withSlot ? slotEl : null }}>
      <TransactionForm onSubmit={onSubmit} onCancel={() => {}} {...props} />
    </ModalKeyboardContext.Provider>,
  );
  return onSubmit;
};

const amountInput = () => screen.getByPlaceholderText("0.00") as HTMLInputElement;
const focusAmount = () => act(() => amountInput().focus());
const footer = () => screen.getByTestId("form-footer");

describe("TransactionForm category chips above the keyboard", () => {
  it("shows chips and hides the footer while the amount is focused with the keyboard open", () => {
    renderForm();
    focusAmount();

    expect(within(slotEl).getByRole("toolbar", { name: "Pick a category" })).toBeTruthy();
    expect(footer().classList.contains("hidden")).toBe(true);
  });

  it("picks the category and closes the keyboard on a chip tap", async () => {
    const onSubmit = renderForm();
    focusAmount();
    fireEvent.change(amountInput(), { target: { value: "222" } });

    fireEvent.click(within(slotEl).getByRole("button", { name: /Food/ }));

    expect(document.activeElement).not.toBe(amountInput());
    expect(within(slotEl).queryByRole("toolbar")).toBeNull();
    expect(footer().classList.contains("hidden")).toBe(false);

    fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: "food", amount: 222 });
  });

  it("opens the category picker from More…", async () => {
    renderForm();
    focusAmount();

    fireEvent.click(within(slotEl).getByRole("button", { name: /More…/ }));

    // The form view animates out first, so the picker and the strip's removal both land async.
    await waitFor(() => expect(screen.getByText("Bills")).toBeTruthy());
    expect(within(slotEl).queryByRole("toolbar")).toBeNull();
  });

  it("follows the transaction type", () => {
    renderForm({ initialData: { type: "INCOME" } });
    focusAmount();

    const strip = within(slotEl).getByRole("toolbar");
    expect(within(strip).getByRole("button", { name: /Salary/ })).toBeTruthy();
    expect(within(strip).queryByRole("button", { name: /Food/ })).toBeNull();
  });

  it("does nothing when the keyboard is closed", () => {
    renderForm({ keyboardOpen: false });
    focusAmount();

    expect(within(slotEl).queryByRole("toolbar")).toBeNull();
    expect(footer().classList.contains("hidden")).toBe(false);
  });

  it("keeps the footer when there is no slot", () => {
    renderForm({ withSlot: false });
    focusAmount();

    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(footer().classList.contains("hidden")).toBe(false);
  });

  it("keeps the footer while categories load", () => {
    categoryMocks.useCategoriesQuery.mockImplementation(() => ({ data: undefined, isLoading: true }));
    renderForm();
    focusAmount();

    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(footer().classList.contains("hidden")).toBe(false);
  });
});
