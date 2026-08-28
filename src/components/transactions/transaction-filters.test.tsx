import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TransactionFiltersBar,
  type TransactionFilters,
} from "@/components/transactions/transaction-filters";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));

vi.mock("@/hooks/use-labels", () => ({
  useLabelsQuery: () => ({ data: [] }),
}));

const baseFilters: TransactionFilters = {
  search: "",
  type: "ALL",
  month: "2026-08",
  categoryId: null,
  labelId: null,
  createdVia: "ALL",
  amountMin: null,
  amountMax: null,
  sortBy: "date",
  sortDir: "desc",
};

let currentFilters = baseFilters;

const renderFilters = (initial: TransactionFilters = baseFilters) => {
  function Harness() {
    const [filters, setFilters] = useState(initial);
    currentFilters = filters;
    return (
      <TransactionFiltersBar
        filters={filters}
        onChange={setFilters}
        totalCount={10}
      />
    );
  }

  return render(<Harness />);
};

beforeEach(() => {
  vi.useFakeTimers();
  currentFilters = baseFilters;
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false } as Response)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TransactionFiltersBar state updates", () => {
  it("keeps a type change made before the search debounce fires", () => {
    renderFilters();

    fireEvent.change(screen.getByPlaceholderText("Search transactions..."), {
      target: { value: "Amazon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Expenses" }));

    act(() => vi.advanceTimersByTime(300));

    expect(currentFilters).toMatchObject({ search: "Amazon", type: "EXPENSE" });
  });

  it("retains both amount bounds when they are entered within one debounce window", () => {
    renderFilters();

    fireEvent.change(screen.getByPlaceholderText("min"), { target: { value: "100" } });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.change(screen.getByPlaceholderText("max"), { target: { value: "200" } });

    act(() => vi.advanceTimersByTime(500));

    expect(currentFilters).toMatchObject({ amountMin: 100, amountMax: 200 });
    expect((screen.getByPlaceholderText("min") as HTMLInputElement).value).toBe("100");
    expect((screen.getByPlaceholderText("max") as HTMLInputElement).value).toBe("200");
  });

  it("returns safely from All Time to the account current month", () => {
    vi.setSystemTime(new Date("2026-08-31T17:00:00.000Z"));
    renderFilters({ ...baseFilters, month: "ALL" });

    const monthNavigator = screen.getByText("All Time").parentElement;
    expect(monthNavigator).not.toBeNull();
    fireEvent.click(within(monthNavigator!).getAllByRole("button")[1]);

    expect(currentFilters.month).toBe("2026-09");
    expect(screen.getByText("September 2026")).toBeTruthy();
  });
});
