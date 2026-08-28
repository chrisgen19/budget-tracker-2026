import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";

const scheduledLabelMocks = vi.hoisted(() => ({
  useScheduledLabel: vi.fn(() => ({ scheduledLabelId: null })),
}));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: {
      currency: "PHP",
      timezoneOffset: 420,
      transactionAmountAutofocus: false,
    },
  }),
}));

vi.mock("@/hooks/use-categories", () => {
  const categories = [
    {
      id: "food",
      name: "Food",
      type: "EXPENSE",
      icon: "utensils",
      color: "#000000",
    },
  ];
  const quickPreferences = {
    quickExpenseCategories: ["food"],
    quickIncomeCategories: [],
  };

  return {
    useCategoriesQuery: () => ({
      data: categories,
      isLoading: false,
    }),
    useQuickPreferencesQuery: () => ({
      data: quickPreferences,
    }),
  };
});

vi.mock("@/hooks/use-labels", () => ({
  useLabelsQuery: () => ({ data: [] }),
}));

vi.mock("@/hooks/use-scheduled-label", () => ({
  useScheduledLabel: scheduledLabelMocks.useScheduledLabel,
}));

vi.mock("@/components/transactions/label-picker", () => ({
  LabelPicker: () => null,
}));

afterEach(() => vi.useRealTimers());

describe("TransactionForm account-local dates", () => {
  it("passes an absolute instant to schedule matching instead of account wall time", () => {
    render(
      <TransactionForm
        initialData={{
          amount: 12,
          description: "Dinner",
          type: "EXPENSE",
          date: "2026-08-27T17:30",
          categoryId: "food",
        }}
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    expect(scheduledLabelMocks.useScheduledLabel).toHaveBeenLastCalledWith(
      "2026-08-28T00:30:00.000Z",
      "EXPENSE",
    );
  });

  it("resolves a datetime-local value with the saved account offset on submit", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());

    render(
      <TransactionForm
        initialData={{
          amount: 12,
          description: "Dinner",
          type: "EXPENSE",
          date: "2026-08-27T17:30",
          categoryId: "food",
        }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      date: "2026-08-28T00:30:00.000Z",
    });
  });

  it("prefills Today from the account clock rather than the browser clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T17:00:00.000Z"));

    const { container } = render(
      <TransactionForm
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    const calendarButton = container
      .querySelector("svg.lucide-calendar-days")
      ?.closest("button");
    expect(calendarButton).not.toBeNull();
    act(() => fireEvent.click(calendarButton!));

    const input = container.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    expect(input?.value).toBe("2026-08-31T10:00");
  });
});
