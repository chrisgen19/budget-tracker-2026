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

/** Places the flow marker that tracks the toolbar's own space in the page. */
const setMarkerTop = (container: HTMLElement, top: number) => {
  const marker = container.querySelector("[data-filter-toolbar-marker]")!;
  vi.spyOn(marker, "getBoundingClientRect").mockReturnValue({ top } as DOMRect);
};

/** jsdom reports every layout box as zero, so the toolbar's height is defined in. */
const setToolbarHeight = (height: number) => {
  const toolbar = screen.getByRole("region", { name: "Transaction filters" });
  Object.defineProperty(toolbar, "offsetHeight", { value: height, configurable: true });
};

/**
 * The toolbar's space is past the top once `markerTop + toolbarHeight` clears where
 * the toolbar rests. With no header in the test DOM that resting point is the 61px
 * fallback, and jsdom reports the height as 0 unless `setToolbarHeight` is used, so
 * these two marker positions sit either side of the threshold.
 */
const setToolbarPastTop = (container: HTMLElement, pastTop: boolean) => {
  setMarkerTop(container, pastTop ? -10 : 200);
};

/** The hook coalesces scrolls to one layout read per frame, so flush that frame. */
const scrollWindow = () => {
  fireEvent.scroll(window);
  act(() => {
    vi.advanceTimersByTime(16);
  });
};

const openFilters = () => {
  const trigger = screen.getByRole("button", { name: /^Filters/ });
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByText("Filter & sort").closest("div")! };
};

beforeEach(() => {
  vi.useFakeTimers();
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
  it("pins itself only once its own space has left the screen", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });

    // In its own place it is an ordinary container that scrolls away with the list.
    setToolbarPastTop(container, false);
    scrollWindow();
    expect(toolbar.className).toContain("relative");
    expect(toolbar.className).not.toContain("sticky");

    // Once that space is off the top it becomes an overlay pinned under the header.
    setToolbarPastTop(container, true);
    scrollWindow();
    expect(toolbar.className).toContain("sticky");
    expect(toolbar.className).toContain("top-[61px]");
  });

  it("opens advanced filters in a dialog", () => {
    renderFilters();

    const { trigger } = openFilters();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Amount range")).toBeTruthy();
    expect(screen.getByText("Added via")).toBeTruthy();
    expect(screen.getByText("Sort by")).toBeTruthy();
  });

  it("hides while scrolling and returns after the scroll settles", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    setToolbarPastTop(container, true);

    expect(toolbar.className).toContain("opacity-100");
    scrollWindow();
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

  it("does not move at all while it is still in its own place at the top", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    setToolbarPastTop(container, false);

    // Rubber-band and momentum settling fire scroll events up here too.
    scrollWindow();
    scrollWindow();
    scrollWindow();

    expect(toolbar.className).toContain("opacity-100");
    expect(toolbar.className).toContain("pointer-events-auto");
    expect(toolbar.className).not.toContain("-translate-y-full");
  });

  it("comes back with no transition once its own space is back on screen", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });

    setToolbarPastTop(container, true);
    scrollWindow();
    expect(toolbar.className).toContain("-translate-y-full");

    // Scrolling back up to the top. The toolbar's space and the toolbar itself have
    // to arrive together: a transition here shows the empty space filling in.
    setToolbarPastTop(container, false);
    scrollWindow();
    expect(toolbar.className).toContain("opacity-100");
    expect(toolbar.className).not.toContain("transition-all");
  });

  it("starts hiding once it has scrolled under the header", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });

    setToolbarPastTop(container, false);
    scrollWindow();
    expect(toolbar.className).not.toContain("-translate-y-full");

    setToolbarPastTop(container, true);
    scrollWindow();
    expect(toolbar.className).toContain("-translate-y-full");
  });

  it("counts its own height when deciding whether its space has left the screen", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    setToolbarHeight(165);

    // Bottom edge at -100 + 165 = 65, still below the 61px resting point: on screen.
    setMarkerTop(container, -100);
    scrollWindow();
    expect(toolbar.className).toContain("relative");

    // Bottom edge at -110 + 165 = 55, now above it: the space has left the screen.
    setMarkerTop(container, -110);
    scrollWindow();
    expect(toolbar.className).toContain("sticky");
  });

  it("does not hide or blur while a toolbar control has focus", () => {
    renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    const search = screen.getByRole("searchbox", { name: "Search transactions" });

    search.focus();
    scrollWindow();

    expect(document.activeElement).toBe(search);
    expect(toolbar.className).toContain("opacity-100");
    expect(toolbar.className).not.toContain("pointer-events-none");
  });

  it("still hides after a toolbar button was tapped", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    setToolbarPastTop(container, true);
    // Index 1 is the mobile navigator. Index 0 is the `hidden sm:flex` copy, which
    // jsdom still returns because it applies no Tailwind, and which is display:none
    // at the only widths this behaviour applies to.
    const previousMonth = screen.getAllByRole("button", { name: "Previous month" })[1];

    // A button keeps focus after a tap. Only text entry may pin the toolbar open,
    // or one tap on a month arrow stops it ducking for the rest of the visit.
    fireEvent.click(previousMonth);
    previousMonth.focus();
    expect(toolbar.contains(document.activeElement)).toBe(true);

    // Past the window in which a scroll is taken to be the browser bringing a newly
    // focused control into view — this is the reader scrolling the list afterwards.
    act(() => vi.advanceTimersByTime(150));
    scrollWindow();

    expect(toolbar.className).toContain("-translate-y-full");
  });

  it("does not hide on the scroll that brings a newly focused control into view", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    setToolbarPastTop(container, true);
    const previousMonth = screen.getAllByRole("button", { name: "Previous month" })[1];

    // Tabbing into the toolbar makes the browser scroll the control into view.
    // Ducking on that scroll would hide the control the reader was just handed.
    fireEvent.focus(previousMonth);
    previousMonth.focus();
    scrollWindow();
    expect(toolbar.className).toContain("opacity-100");

    // A scroll later, with that button still focused, is the reader moving the page.
    act(() => vi.advanceTimersByTime(150));
    scrollWindow();
    expect(toolbar.className).toContain("-translate-y-full");
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

    scrollWindow();

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
