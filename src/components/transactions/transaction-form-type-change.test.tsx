import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";
import type { TransactionWithCategory } from "@/types";

/**
 * Its own file, with its own category mock.
 *
 * The mock in `transaction-form.test.tsx` returns one fixed list whatever the type, which is
 * exactly the condition under test here: `useCategoriesQuery(selectedType)` really is type-scoped,
 * so a category vanishes from the picker the moment the type is toggled away from it.
 */
vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: { currency: "PHP", timezoneOffset: -480, transactionAmountAutofocus: false },
  }),
}));

vi.mock("@/hooks/use-categories", () => ({
  useCategoriesQuery: (type: "INCOME" | "EXPENSE") => ({
    data:
      type === "EXPENSE"
        ? [{ id: "food", name: "Food", type: "EXPENSE", icon: "utensils", color: "#000" }]
        : [{ id: "salary", name: "Salary", type: "INCOME", icon: "wallet", color: "#111" }],
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

const existing = {
  id: "tx_1",
  amount: 250,
  description: "Groceries",
  type: "EXPENSE",
  date: "2026-08-25T09:00:00.000Z",
  categoryId: "food",
  category: { id: "food", name: "Food", type: "EXPENSE", icon: "utensils", color: "#000" },
  labels: [],
} as unknown as TransactionWithCategory;

describe("editing a transaction across a type change", () => {
  it("does not submit a category the new type has left behind", async () => {
    // The category reset was skipped entirely when editing, so `categoryId` survived the toggle
    // invisibly: no tile highlights it, and `transactionSchema` only asks for a non-empty string.
    // The request went out with an EXPENSE category on an INCOME transaction. Before the shared
    // write path checked categories the server saved it, which is the corruption
    // `categoriesAreUsable` exists to prevent; now it refuses, and `useUpdateTransaction` shows a
    // generic "Failed to update transaction" for something the form could see coming.
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());

    render(
      <TransactionForm transaction={existing} onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    // Held back by the form's own "Category is required" rule rather than posted and rejected.
    await waitFor(() => expect(screen.getByText("Category is required")).toBeDefined());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits once a category of the new type is chosen", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());

    render(
      <TransactionForm transaction={existing} onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    fireEvent.click(await screen.findByRole("button", { name: /Salary/ }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: "INCOME", categoryId: "salary" });
  });

  it("keeps the category when the type is not touched", async () => {
    // The reset must stay narrow. An edit that only fixes a description has to keep the category
    // it already had, or every edit would demand the user re-pick one.
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());

    render(
      <TransactionForm transaction={existing} onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: "EXPENSE", categoryId: "food" });
  });
});
