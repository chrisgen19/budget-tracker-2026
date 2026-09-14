import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";
import type { TransactionWithCategory } from "@/types";

const userMock = vi.hoisted(() => ({ creditCardsEnabled: true }));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: {
      currency: "PHP",
      timezoneOffset: -480,
      transactionAmountAutofocus: false,
      get creditCardsEnabled() {
        return userMock.creditCardsEnabled;
      },
    },
  }),
}));

vi.mock("@/hooks/use-categories", () => {
  // Built once, for the stable identity the form's category effects depend on.
  const byType = {
    EXPENSE: [
      { id: "food", name: "Food", type: "EXPENSE", icon: "utensils", color: "#000000" },
      { id: "subs", name: "Subscriptions", type: "EXPENSE", icon: "Film", color: "#FF6B6B" },
    ],
    INCOME: [{ id: "salary", name: "Salary", type: "INCOME", icon: "wallet", color: "#000000" }],
  };
  const quickPreferences = { quickExpenseCategories: ["food", "subs"], quickIncomeCategories: [] };
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
vi.mock("@/hooks/use-credit-accounts", () => {
  const cards = [{ id: "card-1", name: "BPI", color: "#5B6B8C", balance: 76566.08 }];
  return { useCreditAccountsQuery: () => ({ data: cards, isLoading: false, isError: false }) };
});
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const submit = () =>
  fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);

const renderForm = (props: Partial<Parameters<typeof TransactionForm>[0]> = {}) => {
  const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
  render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} {...props} />);
  return onSubmit;
};

const cardPurchase = {
  id: "tx-1",
  amount: 1111,
  description: "Google One",
  type: "EXPENSE",
  date: new Date("2026-08-25T04:00:00.000Z"),
  categoryId: "subs",
  creditAccountId: "card-1",
  creditAccount: { id: "card-1", name: "BPI", color: "#5B6B8C" },
  category: { id: "subs", name: "Subscriptions" },
  labels: [],
} as unknown as TransactionWithCategory;

describe("TransactionForm paid with", () => {
  // The /admin/settings switch keeps cards to admins until it is turned on for everyone.
  it("shows no Paid with field when credit cards are not enabled for this user", () => {
    userMock.creditCardsEnabled = false;
    renderForm({ initialData: { amount: 250, categoryId: "food" } });

    expect(screen.queryByText("Paid with")).toBeNull();
    userMock.creditCardsEnabled = true;
  });

  // Every flow sharing this form (receipts, bills, quick add) must post what it did before cards.
  it("sends no card field for an expense paid from the bank", async () => {
    const onSubmit = renderForm({ initialData: { amount: 250, categoryId: "food" } });

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("creditAccountId");
  });

  it("sends the card an expense in any category was paid with", async () => {
    const onSubmit = renderForm({ initialData: { amount: 1111, categoryId: "subs" } });

    fireEvent.click(screen.getByRole("button", { name: /Bank \/ cash/ }));
    fireEvent.click(screen.getByRole("radio", { name: /BPI/ }));
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: "subs", creditAccountId: "card-1" });
  });

  it("names the card on an edited purchase, and clears it when set back to bank or cash", async () => {
    const onSubmit = renderForm({ transaction: cardPurchase });

    fireEvent.click(screen.getByRole("button", { name: /BPI/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Bank \/ cash/ }));
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ creditAccountId: null });
  });

  // The server refuses income on a card, so the form has to send the unlink.
  it("drops the card when an edited purchase is switched to income", async () => {
    const onSubmit = renderForm({ transaction: cardPurchase });

    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: "INCOME", creditAccountId: null });
  });
});
