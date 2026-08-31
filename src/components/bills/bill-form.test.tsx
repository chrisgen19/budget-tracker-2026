import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillForm } from "@/components/bills/bill-form";
import type { ScheduledTransactionInput } from "@/lib/validations";
import type { ScheduledTransactionWithCategory } from "@/types";

/*
 * The browser zone is forced west of UTC and the account is UTC+8, so the browser day, the UTC
 * day and the account day can all disagree. Any of the three wrong sources therefore produces a
 * visibly different value -- east of Greenwich, where this repo is developed, a browser-local
 * reading of a UTC-midnight anchor lands on the right day by luck and would prove nothing.
 */
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/Los_Angeles";

/**
 * Restore the ambient zone.
 *
 * `process.env.TZ = undefined` writes the *string* "undefined", which is not a zone: Node falls
 * back to UTC and the machine's real offset is gone for everything that runs afterwards. TZ is
 * usually unset here (the zone comes from /etc/localtime), so that is the common case, not the
 * corner one.
 */
const restoreTimeZone = () => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
};

afterAll(restoreTimeZone);

const userMocks = vi.hoisted(() => ({ timezoneOffset: -480 }));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: {
      currency: "PHP",
      get timezoneOffset() {
        return userMocks.timezoneOffset;
      },
    },
  }),
}));

vi.mock("@/hooks/use-categories", () => {
  // Hoisted so their identity is stable across renders. Returning fresh literals re-fires the
  // form's category effect on every render, which setValue then re-renders into a live-lock.
  const categories = [
    { id: "rent", name: "Rent", type: "EXPENSE", icon: "home", color: "#000000" },
  ];
  const quickPreferences = { quickExpenseCategories: ["rent"], quickIncomeCategories: [] };

  return {
    useCategoriesQuery: () => ({ data: categories, isLoading: false }),
    useQuickPreferencesQuery: () => ({ data: quickPreferences }),
  };
});

vi.mock("@/hooks/use-labels", () => {
  const labels: unknown[] = [];
  return { useLabelsQuery: () => ({ data: labels }) };
});
vi.mock("@/components/transactions/label-picker", () => ({ LabelPicker: () => null }));

/** A bill as the API sends it: date-only values serialised at UTC midnight. */
const bill = (overrides: Partial<ScheduledTransactionWithCategory> = {}) =>
  ({
    id: "bill-1",
    amount: 1200,
    description: "Rent",
    type: "EXPENSE",
    categoryId: "rent",
    frequency: "MONTHLY",
    customIntervalDays: null,
    reminderDaysBefore: 0,
    startDate: "2026-09-05T00:00:00.000Z",
    endDate: null,
    labels: [],
    ...overrides,
  }) as unknown as ScheduledTransactionWithCategory;

const dateInput = (container: HTMLElement, name: "startDate" | "endDate") =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`);

/** The optional end-date switch: the only bare toggle button in the form. */
const endDateToggle = (container: HTMLElement) => {
  const toggle = container.querySelector<HTMLButtonElement>("button.rounded-full");
  if (!toggle) throw new Error("end-date toggle not found");
  return toggle;
};

beforeEach(() => {
  userMocks.timezoneOffset = -480;
});
afterEach(() => vi.useRealTimers());

describe("BillForm date-only bill dates", () => {
  it("shows the stored start date, not the browser's reading of it", () => {
    const { container } = render(
      <BillForm bill={bill()} onSubmit={() => Promise.resolve()} onCancel={() => {}} />,
    );

    expect(dateInput(container, "startDate")?.value).toBe("2026-09-05");
  });

  it("shows the stored end date too", () => {
    const { container } = render(
      <BillForm
        bill={bill({ endDate: "2026-12-31T00:00:00.000Z" as unknown as Date })}
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    expect(dateInput(container, "endDate")?.value).toBe("2026-12-31");
  });

  it("submits both dates unchanged when the user edits nothing else", async () => {
    // The write bug: a shifted startDate makes PUT /api/bills/[id] recalculate the whole
    // schedule from the wrong day, and a shifted endDate stops it a day early.
    const onSubmit = vi.fn((_data: ScheduledTransactionInput) => Promise.resolve());

    render(
      <BillForm
        bill={bill({ endDate: "2026-12-31T00:00:00.000Z" as unknown as Date })}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      startDate: "2026-09-05",
      endDate: "2026-12-31",
    });
  });
});

describe("BillForm new-bill default", () => {
  it("defaults to the account's day where the browser and UTC are both still yesterday", () => {
    vi.useFakeTimers();
    // 17:00Z on 31 August is 01:00 on 1 September at UTC+8, while UTC and the UTC-7 browser
    // both still read 31 August. One assertion separates all three sources.
    vi.setSystemTime(new Date("2026-08-31T17:00:00.000Z"));

    const { container } = render(
      <BillForm onSubmit={() => Promise.resolve()} onCancel={() => {}} />,
    );

    expect(dateInput(container, "startDate")?.value).toBe("2026-09-01");
  });

  it("defaults to the account's day where UTC has already moved on", () => {
    vi.useFakeTimers();
    // 02:00Z on 1 September is still 19:00 on 31 August for a UTC-7 account.
    vi.setSystemTime(new Date("2026-09-01T02:00:00.000Z"));
    userMocks.timezoneOffset = 420;

    const { container } = render(
      <BillForm onSubmit={() => Promise.resolve()} onCancel={() => {}} />,
    );

    expect(dateInput(container, "startDate")?.value).toBe("2026-08-31");
  });
});

describe("BillForm end-date validation", () => {
  it("refuses an end date before the start date and says so", async () => {
    const onSubmit = vi.fn((_data: ScheduledTransactionInput) => Promise.resolve());

    const { container } = render(
      <BillForm
        bill={bill({ endDate: "2026-12-31T00:00:00.000Z" as unknown as Date })}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(dateInput(container, "endDate")!, { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(
      await screen.findByText("End date must be on or after start date"),
    ).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("drops the complaint when the end date is switched off", async () => {
    // Switching the toggle off clears the value, so there is nothing left to complain about.
    // The message must not outlive the field it describes -- nor come back with the toggle,
    // which is what happens if the stale error is merely hidden rather than cleared.
    const { container } = render(
      <BillForm
        bill={bill({ endDate: "2026-12-31T00:00:00.000Z" as unknown as Date })}
        onSubmit={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(dateInput(container, "endDate")!, { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await screen.findByText("End date must be on or after start date");

    fireEvent.click(endDateToggle(container));
    await waitFor(() =>
      expect(screen.queryByText("End date must be on or after start date")).toBeNull(),
    );

    // And it stays gone when the field comes back: a merely hidden error would return with it.
    fireEvent.click(endDateToggle(container));
    expect(dateInput(container, "endDate")).not.toBeNull();
    expect(screen.queryByText("End date must be on or after start date")).toBeNull();
  });
});
