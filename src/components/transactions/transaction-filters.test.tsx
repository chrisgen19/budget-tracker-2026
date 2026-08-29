import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TransactionFiltersBar,
  type TransactionFilters,
} from "@/components/transactions/transaction-filters";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));

const filterOptionState = vi.hoisted(() => ({
  value: {
    categories: [] as { id: string; name: string }[],
    categoriesPending: false,
    categoriesError: false,
    retryCategories: vi.fn(),
    labels: [] as { id: string; name: string }[],
    labelsPending: false,
    labelsError: false,
    retryLabels: vi.fn(),
  },
}));

vi.mock("@/hooks/use-transaction-filter-options", () => ({
  useTransactionFilterOptions: () => filterOptionState.value,
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
    return <TransactionFiltersBar filters={filters} onChange={setFilters} totalCount={10} />;
  }

  return render(<Harness />);
};

/** jsdom's `scrollY` is a read-only getter, so a scroll position has to be defined in. */
const setScrollY = (y: number) => {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
};

const openFilters = () => {
  const trigger = screen.getByRole("button", { name: /^Filters/ });
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByText("Filter & sort").closest("div")! };
};

beforeEach(() => {
  vi.useFakeTimers();
  setScrollY(0);
  currentFilters = baseFilters;
  filterOptionState.value.categories = [];
  filterOptionState.value.categoriesPending = false;
  filterOptionState.value.categoriesError = false;
  filterOptionState.value.labels = [];
  filterOptionState.value.labelsPending = false;
  filterOptionState.value.labelsError = false;
  filterOptionState.value.retryCategories.mockClear();
  filterOptionState.value.retryLabels.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TransactionFiltersBar", () => {
  it("keeps the compact toolbar sticky and opens advanced filters in a dialog", () => {
    renderFilters();

    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    expect(toolbar.className).toContain("sticky");
    expect(toolbar.className).toContain("top-[61px]");

    const { trigger } = openFilters();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Amount range")).toBeTruthy();
    expect(screen.getByText("Added via")).toBeTruthy();
    expect(screen.getByText("Sort by")).toBeTruthy();
  });

  it("hides while scrolling and returns after the scroll settles", () => {
    renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    setScrollY(400);

    expect(toolbar.className).toContain("opacity-100");
    fireEvent.scroll(window);
    expect(toolbar.className).toContain("-translate-y-full");
    expect(toolbar.className).toContain("opacity-0");
    expect(toolbar.className).toContain("pointer-events-none");
    expect(toolbar.hasAttribute("inert")).toBe(false);
    expect(toolbar.getAttribute("aria-hidden")).toBeNull();

    act(() => vi.advanceTimersByTime(179));
    expect(toolbar.className).toContain("opacity-0");
    act(() => vi.advanceTimersByTime(1));
    expect(toolbar.className).toContain("opacity-100");
    expect(toolbar.className).toContain("pointer-events-auto");
  });

  it("stays visible while the page is at the top", () => {
    renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });

    // iOS rubber-band and momentum settling fire scroll events at the top.
    setScrollY(0);
    fireEvent.scroll(window);
    fireEvent.scroll(window);
    fireEvent.scroll(window);

    expect(toolbar.className).toContain("opacity-100");
    expect(toolbar.className).toContain("pointer-events-auto");
    expect(toolbar.className).not.toContain("-translate-y-full");
  });

  it("does not hide or blur while a toolbar control has focus", () => {
    renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    const search = screen.getByRole("searchbox", { name: "Search transactions" });

    search.focus();
    fireEvent.scroll(window);

    expect(document.activeElement).toBe(search);
    expect(toolbar.className).toContain("opacity-100");
    expect(toolbar.className).not.toContain("pointer-events-none");
  });

  it("keeps the sticky toolbar visible while scrolling at desktop widths", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) =>
        ({
          matches: query === "(min-width: 640px)",
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
      ),
    );
    renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });

    fireEvent.scroll(window);

    expect(toolbar.className).toContain("opacity-100");
    expect(toolbar.className).not.toContain("pointer-events-none");
  });

  it("stages advanced changes until Apply filters is pressed", () => {
    renderFilters();
    openFilters();

    fireEvent.click(screen.getByRole("button", { name: "Telegram" }));
    fireEvent.click(screen.getByRole("button", { name: "Highest amount" }));
    expect(currentFilters).toMatchObject({ createdVia: "ALL", sortBy: "date" });

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(currentFilters).toMatchObject({ createdVia: "TELEGRAM", sortBy: "amount", sortDir: "desc" });
    expect(screen.getByRole("button", { name: /Filters/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Source: Telegram")).toBeTruthy();
  });

  it("discards staged changes when the dialog is closed", () => {
    renderFilters();
    openFilters();

    fireEvent.click(screen.getByRole("button", { name: "Telegram" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Filter & sort" }));

    expect(currentFilters.createdVia).toBe("ALL");
    expect(screen.getByRole("button", { name: "Filters" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a type change made before the search debounce fires", () => {
    renderFilters();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search transactions" }), {
      target: { value: "Amazon" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Expenses" })[0]);
    act(() => vi.advanceTimersByTime(300));

    expect(currentFilters).toMatchObject({ search: "Amazon", type: "EXPENSE" });
  });

  it("applies both amount bounds together", () => {
    renderFilters();
    openFilters();

    fireEvent.change(screen.getByPlaceholderText("Minimum"), { target: { value: "100" } });
    fireEvent.change(screen.getByPlaceholderText("Maximum"), { target: { value: "200" } });
    expect(currentFilters).toMatchObject({ amountMin: null, amountMax: null });

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(currentFilters).toMatchObject({ amountMin: 100, amountMax: 200 });
    expect(screen.getByText("Amount: ₱100–₱200")).toBeTruthy();
  });

  it("blocks an inverted amount range with a useful error", () => {
    renderFilters();
    openFilters();

    fireEvent.change(screen.getByPlaceholderText("Minimum"), { target: { value: "300" } });
    fireEvent.change(screen.getByPlaceholderText("Maximum"), { target: { value: "100" } });

    expect(screen.getByText(/Maximum amount must be greater/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Apply filters" }).disabled).toBe(true);
    expect(currentFilters).toMatchObject({ amountMin: null, amountMax: null });
  });

  it("rejects negative amount bounds", () => {
    renderFilters();
    openFilters();

    fireEvent.change(screen.getByPlaceholderText("Minimum"), { target: { value: "-1" } });

    expect(screen.getByText("Amounts must be zero or greater.")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Apply filters" }).disabled).toBe(true);
    expect(currentFilters.amountMin).toBeNull();
  });

  it("cancels pending search input when Clear all is pressed", () => {
    renderFilters({ ...baseFilters, createdVia: "TELEGRAM" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search transactions" }), {
      target: { value: "Amazon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    act(() => vi.advanceTimersByTime(300));

    expect(currentFilters).toMatchObject({ search: "", createdVia: "ALL" });
    expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search transactions" }).value).toBe("");
  });

  it("returns safely from All time to the account current month", () => {
    vi.setSystemTime(new Date("2026-08-31T17:00:00.000Z"));
    renderFilters({ ...baseFilters, month: "ALL" });

    fireEvent.click(screen.getAllByRole("button", { name: "Next month" })[0]);

    expect(currentFilters.month).toBe("2026-09");
    expect(screen.getAllByText("September 2026").length).toBeGreaterThan(0);
  });

  it("lets the user choose any month from the month label", () => {
    renderFilters();

    fireEvent.click(screen.getAllByRole("button", { name: "Choose month, August 2026" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    fireEvent.click(screen.getByRole("button", { name: "Feb" }));

    expect(currentFilters.month).toBe("2024-02");
    expect(screen.getAllByText("February 2024").length).toBeGreaterThan(0);
  });

  it("renders one consistently formatted result count even without active filters", () => {
    renderFilters();

    expect(screen.getAllByText("10 transactions")).toHaveLength(1);
    expect(screen.getAllByText("10 transactions")[0].getAttribute("aria-live")).toBe("polite");
  });

  it("clears an unavailable selected label from the draft before applying", () => {
    renderFilters({ ...baseFilters, labelId: "deleted-label" });
    openFilters();

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    expect(currentFilters.labelId).toBeNull();
  });

  it("allows both amount inputs to shrink inside a narrow dialog", () => {
    renderFilters();
    openFilters();

    expect(screen.getByPlaceholderText("Minimum").parentElement?.className).toContain("min-w-0");
    expect(screen.getByPlaceholderText("Maximum").parentElement?.className).toContain("min-w-0");
  });

  it("renders a retryable category error without stale options", () => {
    filterOptionState.value.categories = [];
    filterOptionState.value.categoriesError = true;
    renderFilters({ ...baseFilters, type: "EXPENSE", categoryId: "income-category" });
    openFilters();

    expect(screen.queryByRole("option", { name: "Salary" })).toBeNull();
    expect(screen.getByRole("button", { name: /Couldn’t load categories\. Retry/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Couldn’t load categories\. Retry/ }));
    expect(filterOptionState.value.retryCategories).toHaveBeenCalledOnce();
  });

  it("uses 44px minimum touch targets for compact filter controls", () => {
    renderFilters();
    const search = screen.getByRole("searchbox", { name: "Search transactions" });
    fireEvent.change(search, { target: { value: "coffee" } });

    expect(screen.getByRole("button", { name: "Clear search" }).className).toContain("min-h-11");
    expect(screen.getAllByRole("button", { name: "Previous month" })[0].className).toContain("min-w-11");
    expect(screen.getByRole("button", { name: "All transactions" }).className).toContain("min-w-11");

    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole("button", { name: /Remove Search: coffee filter/ }).className).toContain("min-h-11");
  });
});
