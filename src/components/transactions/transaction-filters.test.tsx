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
  it("keeps advanced controls in the compact drawer below the wide desktop breakpoint", () => {
    const { container } = renderFilters();

    const toggle = screen.getByRole("button", { name: "Toggle filters" });
    expect(toggle.className).toContain("min-[1440px]:hidden");
    expect(toggle.className).toContain("min-h-11");
    expect(toggle.className).toContain("min-w-11");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const desktopCategory = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Category",
    );
    expect(desktopCategory?.parentElement?.className).toContain("hidden min-[1440px]:block");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Amount range")).toBeTruthy();
    expect(screen.getByText("Added by")).toBeTruthy();
    expect(screen.getByText("Sort by")).toBeTruthy();
  });

  it("keeps compact menus in flow without stealing desktop dropdown refs", () => {
    const { container } = renderFilters();
    const toggle = screen.getByRole("button", { name: "Toggle filters" });

    fireEvent.click(toggle);
    const compactSortField = screen.getByText("Sort by").parentElement;
    expect(compactSortField).not.toBeNull();
    fireEvent.click(within(compactSortField!).getByRole("button", { name: "Date (newest)" }));

    const sortButtons = within(compactSortField!).getAllByRole("button", {
      name: "Date (newest)",
    });
    const compactSortMenu = sortButtons.at(-1)?.parentElement;
    expect(compactSortMenu?.className).toContain("relative");
    expect(compactSortMenu?.className).not.toContain("absolute");

    const desktopCategory = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.trim() === "Category" &&
        button.parentElement?.className.includes("min-[1440px]:block"),
    );
    expect(desktopCategory).toBeTruthy();
    const desktopCategoryContainer = desktopCategory!.parentElement!;

    fireEvent.click(desktopCategory!);
    const desktopAllCategories = within(desktopCategoryContainer).getByRole("button", {
      name: "All categories",
    });
    fireEvent.mouseDown(desktopAllCategories);
    expect(desktopCategory!.querySelector("svg")?.getAttribute("class")).toContain("rotate-180");

    fireEvent.mouseDown(document.body);
    expect(desktopCategory!.querySelector("svg")?.getAttribute("class")).not.toContain(
      "rotate-180",
    );
  });

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

  it("does not restore pending inputs after clearing all filters", () => {
    renderFilters({ ...baseFilters, type: "EXPENSE" });

    fireEvent.change(screen.getByPlaceholderText("Search transactions..."), {
      target: { value: "Amazon" },
    });
    fireEvent.change(screen.getByPlaceholderText("min"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    act(() => vi.advanceTimersByTime(500));

    expect(currentFilters).toMatchObject({ search: "", type: "ALL", amountMin: null });
    expect((screen.getByPlaceholderText("Search transactions...") as HTMLInputElement).value)
      .toBe("");
    expect((screen.getByPlaceholderText("min") as HTMLInputElement).value).toBe("");
  });

  it("does not restore an amount after its chip cancels a pending replacement", () => {
    renderFilters({ ...baseFilters, amountMin: 50 });

    fireEvent.change(screen.getByPlaceholderText("min"), { target: { value: "100" } });
    const chip = screen.getByText("Min: ₱50").closest("span");
    expect(chip).not.toBeNull();
    fireEvent.click(within(chip!).getByRole("button"));

    act(() => vi.advanceTimersByTime(500));

    expect(currentFilters.amountMin).toBeNull();
    expect((screen.getByPlaceholderText("min") as HTMLInputElement).value).toBe("");
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
