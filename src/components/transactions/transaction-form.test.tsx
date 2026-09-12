import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";
import type { TransactionWithCategory } from "@/types";

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
  // Keyed by type and built once: the real hook is a per-type React Query cache, so its `data` is
  // a stable reference until the type changes. An inline literal per call would hand the form a
  // new `categories` array on every render, the category-reset effect would re-run forever and
  // the worker would hang rather than fail.
  const byType = {
    EXPENSE: [
      {
        id: "food",
        name: "Food",
        type: "EXPENSE",
        icon: "utensils",
        color: "#000000",
      },
    ],
    INCOME: [
      {
        id: "salary",
        name: "Salary",
        type: "INCOME",
        icon: "wallet",
        color: "#000000",
      },
    ],
  };
  const all = [...byType.EXPENSE, ...byType.INCOME];
  const quickPreferences = {
    quickExpenseCategories: ["food"],
    // Left empty so `resolveQuickCategories` falls back to the first few INCOME categories,
    // which is what a user who never picked income quick tiles actually sees.
    quickIncomeCategories: [],
  };

  return {
    useCategoriesQuery: (type?: "INCOME" | "EXPENSE") => ({
      data: type ? byType[type] : all,
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
  LabelPicker: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <div>
      <button type="button" onClick={() => onChange(["label-1"])}>
        Select test label
      </button>
      <button type="button" onClick={() => onChange([])}>
        Clear test labels
      </button>
    </div>
  ),
}));

afterEach(() => vi.useRealTimers());

const openDateTimeEditor = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Date and time,/ }));
};

/**
 * The submit button, found by type rather than by accessible name.
 *
 * While `isSubmitting` is true its label is a bare spinner with no text, so a name query cannot
 * see it in precisely the state a test may need to wait out.
 */
const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;

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

    // The category goes in too: a label restricted to other categories must not be auto-applied,
    // and the hook is the client half of the same decision the write path makes.
    expect(scheduledLabelMocks.useScheduledLabel).toHaveBeenLastCalledWith(
      "2026-08-28T00:30:00.000Z",
      "EXPENSE",
      "food",
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
        "food",
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
    // Let the submit settle completely before collapsing. react-hook-form delivers `errors` while
    // it validates, but `submitCount` only in its final formState batch, alongside
    // `isSubmitting: false` -- so the `findByText` above can resolve *between* those two renders.
    // The field re-expands itself from an effect keyed on `submitCount`, so a collapse landing in
    // that window is undone by the second render and the assertion below then burns its whole
    // timeout. Locally the two renders batch into one flush, which is why this only ever failed
    // on a loaded CI runner.
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(trigger);
    // Awaited, like the identical assertion below. fireEvent does not flush a
    // React state update synchronously, so asserting the class immediately is a
    // race: it held locally and failed once under CI's slower scheduling.
    await waitFor(() => expect(editor?.classList.contains("hidden")).toBe(true));

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
      expect(scheduledLabelMocks.useScheduledLabel).toHaveBeenLastCalledWith(
        "",
        "EXPENSE",
        "food",
      ),
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

  // A class assertion rather than a behavioural one on purpose: the failure is that iOS Safari
  // sizes a native date/time control to its intrinsic content and ignores `w-full`, which no
  // jsdom or Chromium test can observe. What is pinned is that the rewrite in #197, which
  // dropped these classes, cannot recur here.
  it("keeps the native control appearance off both inputs so iOS honours their width", () => {
    render(
      <TransactionForm
        initialData={{ amount: 12, date: "2026-08-27T17:30", categoryId: "food" }}
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    openDateTimeEditor();
    for (const label of ["Date", "Time"]) {
      expect(screen.getByLabelText(label).className, label).toContain("appearance-none");
    }
  });
});

describe("TransactionForm label intent", () => {
  const draft = {
    amount: 12,
    description: "Dinner",
    type: "EXPENSE" as const,
    date: "2026-08-27T17:30",
    categoryId: "food",
  };

  it("omits labelIds when a new transaction's picker is untouched", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    render(
      <TransactionForm initialData={draft} onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("labelIds");
  });

  it("submits explicit label choices after the user changes them", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    render(
      <TransactionForm initialData={draft} onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select test label" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].labelIds).toEqual(["label-1"]);
  });

  it("submits an explicit empty array when the user clears labels", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    render(
      <TransactionForm
        initialData={{ ...draft, labelIds: ["label-1"] }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear test labels" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].labelIds).toEqual([]);
  });

  it("omits labelIds on an untouched edit so the server preserves existing labels", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    const transaction = {
      ...draft,
      id: "transaction-1",
      date: new Date("2026-08-27T17:30:00.000Z"),
      labels: [{ labelId: "label-1" }],
    } as unknown as TransactionWithCategory;

    render(
      <TransactionForm transaction={transaction} onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("labelIds");
  });
});

// The flow the FAB and both page modals actually use: `<TransactionForm onSubmit onCancel />` with
// no `initialData` and no `transaction`. Every other test in this file prefills
// `initialData.categoryId`, which short-circuits the category-reset effect before its third branch
// can run — so the branch that blanks the category on a type change had no coverage at all, and a
// change to that effect's dependency array blanked every tapped category with lint, type-check and
// the whole suite still green (#230).
describe("TransactionForm plain add flow", () => {
  const enterAmount = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value } });

  const tile = (name: string) => screen.getByRole("button", { name });

  it("keeps a tapped category and submits it when nothing was prefilled", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    enterAmount("12");
    fireEvent.click(tile("Food"));

    // Asserted on the tile as well as on the payload: when the reset effect re-runs on its own
    // write, the category is blanked as fast as it is tapped, so what the user sees is a tile that
    // never highlights rather than a save that fails.
    await waitFor(() => expect(tile("Food").className).toContain("ring-amber"));

    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      amount: 12,
      type: "EXPENSE",
      categoryId: "food",
    });
  });

  it("drops a category that does not apply to the new type", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    enterAmount("12");
    fireEvent.click(tile("Food"));
    fireEvent.click(screen.getByRole("button", { name: "Income" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Food" })).toBeNull());
    expect(tile("Salary").className).not.toContain("ring-amber");

    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    expect(await screen.findByText("Category is required")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts a category of the new type after switching", async () => {
    const onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve());
    render(<TransactionForm onSubmit={onSubmit} onCancel={() => {}} />);

    enterAmount("12");
    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salary" }));

    await waitFor(() => expect(tile("Salary").className).toContain("ring-amber"));

    fireEvent.click(screen.getByRole("button", { name: "Add Transaction" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      type: "INCOME",
      categoryId: "salary",
    });
  });
});
