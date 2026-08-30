import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: { currency: "PHP", timezoneOffset: -480, transactionAmountAutofocus: false },
  }),
}));

const EXPENSE_CATS = [
  { id: "transportation", name: "Transportation", type: "EXPENSE", icon: "Car", color: "#000000" },
];
const TRANSFER_CATS = [
  { id: "cat_system_transfer", name: "Transfer", type: "TRANSFER", icon: "ArrowLeftRight", color: "#000000" },
];

vi.mock("@/hooks/use-categories", () => ({
  useCategoriesQuery: (type?: string) => ({
    data: type === "TRANSFER" ? TRANSFER_CATS : EXPENSE_CATS,
    isLoading: false,
  }),
  useQuickPreferencesQuery: () => ({
    data: { quickExpenseCategories: ["transportation"], quickIncomeCategories: [] },
  }),
}));
vi.mock("@/hooks/use-labels", () => ({ useLabelsQuery: () => ({ data: [] }) }));
vi.mock("@/hooks/use-scheduled-label", () => ({
  useScheduledLabel: () => ({ scheduledLabelId: null }),
}));
vi.mock("@/components/transactions/label-picker", () => ({ LabelPicker: () => null }));

const accountsMock = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/hooks/use-accounts", () => ({ useAccountsQuery: () => accountsMock }));

const ACCOUNTS = [
  { id: "checking", name: "Checking", type: "BANK", isActive: true },
  { id: "bpi", name: "BPI Amore", type: "CREDIT_CARD", isActive: true },
];

const typeAmount = (value: string) => {
  const input = document.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
};

const selectNamed = (label: string, value: string) => {
  const el = screen.getByText(label).closest("div")!.querySelector("select") as HTMLSelectElement;
  fireEvent.change(el, { target: { value } });
};

beforeEach(() => {
  accountsMock.data = [];
});

describe("TransactionForm submit with accounts", () => {
  it("submits an ordinary expense when the user has accounts", async () => {
    // The reported bug: "Add Transaction" did nothing. Two independent causes, either of which
    // is enough to make React Hook Form refuse the submit silently — it reports a failed parse by
    // not calling onSubmit at all, so the button simply looked dead.
    accountsMock.data = ACCOUNTS;
    const onSubmit = vi.fn(async (_data: TransactionInput) => {});
    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    typeAmount("255");
    fireEvent.click(screen.getByText("Transportation"));
    fireEvent.click(screen.getByRole("button", { name: /Add Transaction/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      amount: 255,
      type: "EXPENSE",
      categoryId: "transportation",
    });
  });

  it("keeps a chosen category instead of clearing it", async () => {
    // Cause 1. The category effect ends by resetting `categoryId` to "". Adding the watched value
    // to its dependency array made choosing a category re-run the effect, which then wiped the
    // choice, so the field could never be filled and validation could never pass.
    accountsMock.data = ACCOUNTS;
    const onSubmit = vi.fn(async (_data: TransactionInput) => {});
    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    typeAmount("255");
    fireEvent.click(screen.getByText("Transportation"));
    // Submit first: React Hook Form only renders field errors once a submit has been attempted,
    // so asserting on the message without this passes whether or not the category survived.
    fireEvent.click(screen.getByRole("button", { name: /Add Transaction/i }));

    // `jest-dom` is deliberately not installed (it floors at Node 22), so assert on the query
    // result directly rather than with `toBeInTheDocument`.
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.queryByText("Category is required")).toBeNull();
  });

  it("treats an untouched optional account picker as no account", async () => {
    // Cause 2. An unselected <select> yields "", which `z.string().min(1)` rejects — on a field
    // labelled optional, against a picker the user never touched.
    accountsMock.data = ACCOUNTS;
    const onSubmit = vi.fn(async (_data: TransactionInput) => {});
    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    typeAmount("255");
    fireEvent.click(screen.getByText("Transportation"));
    fireEvent.click(screen.getByRole("button", { name: /Add Transaction/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].accountId ?? null).toBeNull();
  });

  it("still submits for a user who has no accounts at all", async () => {
    const onSubmit = vi.fn(async (_data: TransactionInput) => {});
    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    typeAmount("120");
    fireEvent.click(screen.getByText("Transportation"));
    fireEvent.click(screen.getByRole("button", { name: /Add Transaction/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("submits a transfer carrying both accounts and the system category", async () => {
    accountsMock.data = ACCOUNTS;
    const onSubmit = vi.fn(async (_data: TransactionInput) => {});
    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    typeAmount("255");
    selectNamed("From account", "checking");
    selectNamed("To account", "bpi");
    fireEvent.click(screen.getByRole("button", { name: /Add Transaction/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      type: "TRANSFER",
      accountId: "checking",
      transferAccountId: "bpi",
      categoryId: "cat_system_transfer",
    });
  });
});
