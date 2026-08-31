import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const openDateTimeEditor = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Date and time,/ }));
};

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

  it("resolves the account wall-clock date and time with the saved offset on submit", async () => {
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

    render(
      <TransactionForm
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Date and time,/ });
    const editor = document.getElementById(trigger.getAttribute("aria-controls")!);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(editor?.classList.contains("hidden")).toBe(true);

    openDateTimeEditor();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-08-31");
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("10:00");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(editor?.classList.contains("hidden")).toBe(false);
  });

  it("adds the account-local current time when initial data contains only a date", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-31T17:00:00.000Z"));
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());

    render(
      <TransactionForm
        initialData={{ amount: 12, date: "2026-08-15", categoryId: "food" }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    openDateTimeEditor();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-08-15");
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("10:00");

    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].date).toBe("2026-08-15T17:00:00.000Z");
  });

  it("lets the user expand and edit separate date and time fields", async () => {
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

    openDateTimeEditor();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-05" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "21:15" } });

    await waitFor(() =>
      expect(scheduledLabelMocks.useScheduledLabel).toHaveBeenLastCalledWith(
        "2026-09-06T04:15:00.000Z",
        "EXPENSE",
      ),
    );
    expect(
      screen.getByRole("button", { name: /September 5, 2026 at 9:15 PM/ }),
    ).toBeTruthy();
  });

  it("reports which half of the date and time is missing", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    render(
      <TransactionForm
        initialData={{ amount: 12, categoryId: "food" }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    openDateTimeEditor();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    expect(await screen.findByText("Choose a time.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("opens the editor automatically for a suspicious receipt date", () => {
    render(
      <TransactionForm
        initialData={{ amount: 12, date: "2023-08-15T08:45", categoryId: "food" }}
        dateWarning
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /^Date and time,/ }).getAttribute("aria-expanded"))
      .toBe("true");
    expect(screen.getByLabelText("Date")).toBeTruthy();
    expect(screen.getByText(/receipt date year looks incorrect/i)).toBeTruthy();
  });

  it("reopens a collapsed editor on submit so the error is never reported into a hidden panel", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    render(
      <TransactionForm
        initialData={{ amount: 12, categoryId: "food" }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Date and time,/ });
    const editor = document.getElementById(trigger.getAttribute("aria-controls")!);

    openDateTimeEditor();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });

    // First submit surfaces the error, then the user collapses the editor on top of it. The
    // error string does not change on the next submit, so only the submit count can reopen it.
    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
    await screen.findByText("Choose a time.");
    fireEvent.click(trigger);
    expect(editor?.classList.contains("hidden")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(editor?.classList.contains("hidden")).toBe(false));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-label")).toContain("Choose a time.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves an incomplete native date control unvalidated until submit", async () => {
    render(
      <TransactionForm
        initialData={{ amount: 12, date: "2026-08-27T17:30", categoryId: "food" }}
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    openDateTimeEditor();
    // Chrome reports "" between segments while a date is retyped.
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });

    await waitFor(() =>
      expect(scheduledLabelMocks.useScheduledLabel).toHaveBeenLastCalledWith("", "EXPENSE"),
    );
    expect(screen.queryByText("Choose a date.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
    expect(await screen.findByText("Choose a date.")).toBeTruthy();
  });

  it("keeps the chosen date in the summary when the time is cleared", () => {
    render(
      <TransactionForm
        initialData={{ amount: 12, date: "2026-09-05T21:15", categoryId: "food" }}
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    openDateTimeEditor();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });

    const trigger = screen.getByRole("button", { name: /^Date and time,/ });
    expect(trigger.getAttribute("aria-label")).toContain("September 5, 2026, time not set");
    expect(screen.getByText("Sep 5 · Not set")).toBeTruthy();
  });
});
