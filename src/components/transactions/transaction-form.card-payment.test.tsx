import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";
import type { TransactionWithCategory } from "@/types";

const cardsMock = vi.hoisted(() => ({
  cards: [] as { id: string; name: string; color: string; balance: number }[],
}));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: { currency: "PHP", timezoneOffset: -480, transactionAmountAutofocus: false },
  }),
}));

vi.mock("@/hooks/use-categories", () => {
  // Built once, for the stable identity the form's category effects depend on.
  const byType = {
    EXPENSE: [
      { id: "food", name: "Food", type: "EXPENSE", icon: "utensils", color: "#000000" },
      { id: "pay", name: "Credit Card Payment", type: "EXPENSE", icon: "CreditCard", color: "#5B6B8C" },
    ],
    INCOME: [{ id: "salary", name: "Salary", type: "INCOME", icon: "wallet", color: "#000000" }],
  };
  const quickPreferences = { quickExpenseCategories: ["food", "pay"], quickIncomeCategories: [] };
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
vi.mock("@/hooks/use-credit-accounts", () => ({
  useCreditAccountsQuery: () => ({ data: cardsMock.cards, isLoading: false, isError: false }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const BPI = { id: "card-1", name: "BPI Credit Card", color: "#5B6B8C", balance: 2295.28 };
const METROBANK = { id: "card-2", name: "Metrobank", color: "#E07C4F", balance: 0 };

const submit = () =>
  fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);

const renderForm = (props: Partial<Parameters<typeof TransactionForm>[0]> = {}) => {
  const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
  render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} {...props} />);
  return onSubmit;
};

describe("TransactionForm card payments", () => {
  // Every flow sharing this form (receipts, bills, quick add) must post what it did before cards.
  it("sends no card field for an ordinary expense", async () => {
    cardsMock.cards = [BPI];
    const onSubmit = renderForm({ initialData: { amount: 250, categoryId: "food" } });

    expect(screen.queryByRole("radiogroup")).toBeNull();
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("creditAccountId");
  });

  it("asks which card a payment pays, and sends the one chosen", async () => {
    cardsMock.cards = [BPI, METROBANK];
    const onSubmit = renderForm({ initialData: { amount: 5000, categoryId: "pay" } });

    fireEvent.click(screen.getByRole("radio", { name: /Metrobank/ }));
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: "pay", creditAccountId: "card-2" });
  });

  it("chooses the only card for a new payment", async () => {
    cardsMock.cards = [BPI];
    const onSubmit = renderForm({ initialData: { amount: 5000, categoryId: "pay" } });

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /BPI/ }).getAttribute("aria-checked")).toBe("true")
    );
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ creditAccountId: "card-1" });
  });

  it("keeps 'No card' once chosen, rather than re-selecting the only card", async () => {
    cardsMock.cards = [BPI];
    const onSubmit = renderForm({ initialData: { amount: 5000, categoryId: "pay" } });

    fireEvent.click(screen.getByRole("radio", { name: "No card" }));
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ creditAccountId: null });
  });

  // The server refuses a card link under any other category, so the form has to send the unlink.
  it("unlinks an edited payment that moves to another category", async () => {
    cardsMock.cards = [BPI];
    const transaction = {
      id: "tx-1",
      amount: 5000,
      description: "BPI payment",
      type: "EXPENSE",
      date: new Date("2026-09-05T02:00:00.000Z"),
      categoryId: "pay",
      creditAccountId: "card-1",
      category: { id: "pay", name: "Credit Card Payment" },
      labels: [],
    } as unknown as TransactionWithCategory;
    const onSubmit = renderForm({ transaction });

    fireEvent.click(screen.getByRole("button", { name: "Food" }));
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: "food", creditAccountId: null });
  });
});
