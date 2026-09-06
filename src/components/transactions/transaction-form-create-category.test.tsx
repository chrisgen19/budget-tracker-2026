import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";

/**
 * The create path with **no** `initialData`, which is how the FAB and both page modals open it
 * (`transactions/page.tsx`, `dashboard/page.tsx` render `<TransactionForm onSubmit onCancel />`).
 *
 * Every create-path case in `transaction-form.test.tsx` passes `initialData.categoryId`, which
 * short-circuits the reset branch before it can run -- so the plain "Add Transaction" flow, the
 * most-used path in the app, had no coverage at all.
 */
vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: { currency: "PHP", timezoneOffset: -480, transactionAmountAutofocus: false },
  }),
}));

// Stable arrays, defined once. Returning a fresh literal per call would make `categories` a new
// reference every render and re-run the effect for reasons unrelated to what is under test.
const EXPENSE = [{ id: "food", name: "Food", type: "EXPENSE", icon: "utensils", color: "#000" }];
const INCOME = [{ id: "salary", name: "Salary", type: "INCOME", icon: "wallet", color: "#111" }];

vi.mock("@/hooks/use-categories", () => ({
  useCategoriesQuery: (type: "INCOME" | "EXPENSE") => ({
    data: type === "EXPENSE" ? EXPENSE : INCOME,
    isLoading: false,
  }),
  useQuickPreferencesQuery: () => ({
    data: { quickExpenseCategories: [], quickIncomeCategories: [] },
  }),
}));

vi.mock("@/hooks/use-labels", () => ({ useLabelsQuery: () => ({ data: [] }) }));
vi.mock("@/hooks/use-scheduled-label", () => ({
  useScheduledLabel: () => ({ scheduledLabelId: null }),
}));
vi.mock("@/components/transactions/label-picker", () => ({ LabelPicker: () => null }));

const fillAmount = () => {
  fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "250" } });
};

describe("creating a transaction with no initialData", () => {
  it("keeps a category the user picked", async () => {
    // The regression this file exists for. `watchedCategoryId` joined the effect's dependency
    // array for the edit-path guard, which made the effect re-run on every category write -- and
    // the create branch above it cleared unconditionally, so tapping a tile immediately blanked
    // it again. No tile ever highlighted and Submit was blocked by "Category is required", which
    // is every new transaction from the FAB, the dashboard and the transactions page.
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());

    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    fillAmount();
    fireEvent.click(await screen.findByRole("button", { name: /Food/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: "EXPENSE", categoryId: "food" });
  });

  it("still drops the category when the type changes", async () => {
    // The reset has a real job: a category picked as an expense cannot survive a switch to
    // Income, where it is not even in the list. Fixing the bug above must not cost that.
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());

    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    fillAmount();
    fireEvent.click(await screen.findByRole("button", { name: /Food/ }));
    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(screen.getByText("Category is required")).toBeDefined());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts a category of the new type after switching", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());

    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    fillAmount();
    fireEvent.click(await screen.findByRole("button", { name: /Food/ }));
    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    fireEvent.click(await screen.findByRole("button", { name: /Salary/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: "INCOME", categoryId: "salary" });
  });
});
