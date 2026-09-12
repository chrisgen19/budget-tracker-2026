import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TransactionFiltersBar,
  type TransactionFilters,
} from "@/components/transactions/transaction-filters";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));

vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({ hideAmounts: privacyState.hideAmounts }),
}));

const privacyState = vi.hoisted(() => ({ hideAmounts: false }));

const summaryState = vi.hoisted(() => ({
  value: {
    data: { count: 10, income: 0, expense: 2500, net: -2500 } as
      | { count: number; income: number; expense: number; net: number }
      | undefined,
    isError: false,
  },
}));

vi.mock("@/hooks/use-transactions", () => ({
  useTransactionSummaryQuery: () => summaryState.value,
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
  period: "monthly",
  from: "2026-08-01",
  to: "2026-08-31",
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
    return <TransactionFiltersBar filters={filters} onChange={setFilters} />;
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

/**
 * jsdom has no ResizeObserver, so the toolbar's own height changing — a chip row
 * collapsing, say — cannot be observed without one. This records what was observed
 * and hands back the callback, so a test can raise the notification itself.
 */
const stubResizeObserver = () => {
  const state: { observed: Element[]; notify?: () => void } = { observed: [] };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        state.notify = callback;
      }
      observe(target: Element) {
        state.observed.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  return state;
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

  it("recomputes its position when its own height changes, with no scroll", () => {
    const observer = stubResizeObserver();
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });

    expect(observer.observed).toContain(toolbar);

    setToolbarHeight(165);
    setMarkerTop(container, -100);
    scrollWindow();
    expect(toolbar.className).toContain("relative");

    // The chip row collapses. The toolbar gets shorter, its space moves behind the
    // header, and nothing scrolls — so only the size notification can catch it.
    setToolbarHeight(105);
    act(() => observer.notify!());

    expect(toolbar.className).toContain("sticky");
  });

  it("recomputes its position when the viewport is resized", () => {
    const { container } = renderFilters();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });

    setToolbarHeight(165);
    setMarkerTop(container, -100);
    scrollWindow();
    expect(toolbar.className).toContain("relative");

    setToolbarHeight(105);
    act(() => {
      fireEvent(window, new Event("resize"));
    });

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
    const previousPeriod = screen.getAllByRole("button", { name: "Previous period" })[1];

    // A button keeps focus after a tap. Only text entry may pin the toolbar open,
    // or one tap on a month arrow stops it ducking for the rest of the visit.
    fireEvent.click(previousPeriod);
    previousPeriod.focus();
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
    const previousPeriod = screen.getAllByRole("button", { name: "Previous period" })[1];

    // Tabbing into the toolbar makes the browser scroll the control into view.
    // Ducking on that scroll would hide the control the reader was just handed.
    fireEvent.focus(previousPeriod);
    previousPeriod.focus();
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

  it("never commits a search longer than the server accepts", () => {
    renderFilters();
    const search = screen.getByRole<HTMLInputElement>("searchbox", {
      name: "Search transactions",
    });

    fireEvent.change(search, { target: { value: "x".repeat(300) } });
    act(() => vi.advanceTimersByTime(300));

    expect(search.maxLength).toBe(MAX_TRANSACTION_SEARCH_LENGTH);
    expect(search.value).toHaveLength(MAX_TRANSACTION_SEARCH_LENGTH);
    expect(currentFilters.search).toHaveLength(MAX_TRANSACTION_SEARCH_LENGTH);
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
    // 17:00 UTC on Aug 31 is already September in Manila, which is the month the
    // arrow has to land on — not the UTC one.
    vi.setSystemTime(new Date("2026-08-31T17:00:00.000Z"));
    renderFilters({ ...baseFilters, period: "all", from: null, to: null });

    fireEvent.click(screen.getAllByRole("button", { name: "Next period" })[0]);

    expect(currentFilters).toMatchObject({
      period: "monthly",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(screen.getAllByText("September 2026").length).toBeGreaterThan(0);
  });

  it("lets the user choose any month from the period label", () => {
    renderFilters();

    fireEvent.click(screen.getAllByRole("button", { name: /^Choose period/ })[0]);
    act(() => vi.advanceTimersByTime(60));
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    fireEvent.click(screen.getByRole("button", { name: "Feb" }));

    expect(currentFilters).toMatchObject({
      period: "monthly",
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(screen.getAllByText("February 2024").length).toBeGreaterThan(0);
  });

  it("narrows the ledger to a week, and keeps All time free of stale bounds", () => {
    renderFilters();

    fireEvent.click(screen.getAllByRole("button", { name: /^Choose period/ })[0]);
    act(() => vi.advanceTimersByTime(60));
    fireEvent.click(screen.getByRole("button", { name: "Weeks" }));
    fireEvent.click(screen.getByRole("button", { name: "Aug 10 – Aug 16" }));

    expect(currentFilters).toMatchObject({
      period: "weekly",
      from: "2026-08-10",
      to: "2026-08-16",
    });

    fireEvent.click(screen.getAllByRole("button", { name: /^Choose period/ })[0]);
    act(() => vi.advanceTimersByTime(60));
    fireEvent.click(screen.getByRole("button", { name: "All time" }));

    // The filter schema refuses All time carrying from/to, so a stale week here
    // would 400 the very next list request.
    expect(currentFilters).toMatchObject({ period: "all", from: null, to: null });
  });

  it("reports the filtered total once, beside its count", () => {
    // The bare count used to live here and repeated the page header's own meta.
    // What the toolbar carries now is the thing the header cannot: what the
    // filtered rows add up to.
    renderFilters({ ...baseFilters, type: "EXPENSE" });

    const line = screen.getAllByText("₱2,500.00 spent · 10 transactions");
    expect(line).toHaveLength(1);
    expect(line[0].getAttribute("aria-live")).toBe("polite");
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
    expect(screen.getAllByRole("button", { name: "Previous period" })[0].className).toContain("min-w-11");
    // Two instances now: the rail's, and the search row's from `lg` up.
    expect(screen.getAllByRole("button", { name: "All transactions" })[0].className).toContain(
      "min-w-11",
    );

    act(() => vi.advanceTimersByTime(300));
    // The rail clips vertically (overflow-x forces it), so the chip is 36px with
    // its 44px target carried by a pseudo-element that the rail's padding fits.
    const remove = screen.getByRole("button", { name: /Remove Search: coffee filter/ });
    expect(remove.className).toContain("w-11");
    expect(remove.className).toContain("before:h-11");
  });
});

describe("the return arrow", () => {
  const renderWithReturn = () =>
    render(
      <TransactionFiltersBar
        filters={baseFilters}
        onChange={() => {}}
        returnBar={<a href="/analytics?period=monthly" aria-label="Back to Analytics" />}
      />,
    );

  it("rides inside the toolbar, so it pins and hides with it", () => {
    // The toolbar is the page's one sticky element and already knows where to pin.
    // On the page heading it would scroll away from a long list, and an installed
    // PWA opened cold on this URL has no browser back button to fall back on.
    const { container } = renderWithReturn();
    const toolbar = screen.getByRole("region", { name: "Transaction filters" });
    const link = screen.getByRole("link", { name: "Back to Analytics" });

    expect(toolbar.contains(link)).toBe(true);
    expect(container.querySelector("[data-filter-toolbar-marker]")).toBeTruthy();
  });

  it("shares the search row rather than taking a line of its own", () => {
    // It used to own a bordered row above the controls, which spent a whole line of
    // a phone screen on one arrow.
    renderWithReturn();
    const link = screen.getByRole("link", { name: "Back to Analytics" });
    const search = screen.getByRole("searchbox", { name: "Search transactions" });

    expect(link.parentElement).toBe(search.closest("[role=search]")!.parentElement);
    expect(link.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leaves the row unchanged when there is nowhere to return to", () => {
    renderFilters();
    expect(screen.queryByRole("link", { name: /Back to/ })).toBeNull();
  });
});

describe("the filter rail", () => {
  const rail = (container: HTMLElement) =>
    container.querySelector<HTMLElement>("[data-filter-rail]")!;

  it("renders the type toggle once per breakpoint band instead of three times", () => {
    // Three copies used to exist — a compact one below sm, a full one from sm to
    // lg, and a full one on the search row — each costing a row on a phone, and
    // only one of them carried an aria-label.
    renderFilters();

    expect(screen.getAllByRole("button", { name: "All transactions" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Income" })).toHaveLength(2);
  });

  it("names the type the same way at every width", () => {
    renderFilters();

    for (const button of screen.getAllByRole("button", { name: "Expenses" })) {
      expect(button.textContent).toContain("−");
      expect(button.textContent).toContain("Expenses");
    }
  });

  it("carries the period picker, so a phone keeps one-tap month stepping", () => {
    const { container } = renderFilters();
    const stepper = screen.getAllByRole("button", { name: "Previous period" })[1];

    expect(rail(container).contains(stepper)).toBe(true);
  });

  it("collapses at lg when it holds nothing that width still needs", () => {
    const { container } = renderFilters();
    expect(rail(container).className).toContain("lg:hidden");
  });

  it("stays put at lg once it holds a chip", () => {
    const { container } = renderFilters({ ...baseFilters, type: "EXPENSE" });
    expect(rail(container).className).not.toContain("lg:hidden");
  });

  it("keeps Clear all out of the scroller, where enough chips would bury it", () => {
    const { container } = renderFilters({ ...baseFilters, type: "EXPENSE" });
    const clearAll = screen.getByRole("button", { name: "Clear all" });
    const scroller = rail(container).firstElementChild!;

    expect(rail(container).contains(clearAll)).toBe(true);
    expect(scroller.contains(clearAll)).toBe(false);
  });

  it("offers Clear all for a filter that shows no chip of its own", () => {
    // A category whose name has not loaded yields no chip on purpose, but the
    // filter is live and the way out of it has to exist.
    filterOptionState.value.categories = [];
    const { container } = renderFilters({ ...baseFilters, categoryId: "unloaded" });

    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    expect(rail(container).className).not.toContain("lg:hidden");
  });

  it("pads the scroller so its clipped overflow cannot cut the 44px targets", () => {
    // overflow-x: auto forces the other axis to auto too, so the rail clips
    // vertically and the hit areas overhang their 36px chips by 4px each side.
    const { container } = renderFilters();
    expect(rail(container).firstElementChild!.className).toContain("py-0.5");
  });
});

describe("changing the transaction type", () => {
  it("drops a category chosen under the old type", () => {
    filterOptionState.value.categories = [{ id: "c1", name: "Groceries" }];
    renderFilters({ ...baseFilters, type: "EXPENSE", categoryId: "c1" });

    fireEvent.click(screen.getAllByRole("button", { name: "Income" })[0]);

    expect(currentFilters).toMatchObject({ type: "INCOME", categoryId: null });
  });

  it("drops it from the type chip too, which is the other way to widen the type", () => {
    filterOptionState.value.categories = [{ id: "c1", name: "Groceries" }];
    renderFilters({ ...baseFilters, type: "EXPENSE", categoryId: "c1" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Expenses filter" }));

    expect(currentFilters).toMatchObject({ type: "ALL", categoryId: null });
  });

  it("keeps the category when the type showing is pressed again", () => {
    // aria-pressed says the button is already on. Pressing an on toggle should do
    // nothing, not quietly widen the list to every expense.
    filterOptionState.value.categories = [{ id: "c1", name: "Groceries" }];
    renderFilters({ ...baseFilters, type: "EXPENSE", categoryId: "c1" });
    const before = currentFilters;

    fireEvent.click(screen.getAllByRole("button", { name: "Expenses" })[0]);

    expect(currentFilters).toMatchObject({ type: "EXPENSE", categoryId: "c1" });
    // Same object, not an equal one: the page watches this by identity to reset
    // the page number, drop the selection and announce that to a screen reader.
    expect(currentFilters).toBe(before);
  });

  it("keeps the category when the type arrives from outside rather than a press", () => {
    // Restoring a drill-down by Back re-supplies type and category together. An
    // effect watching filters.type cannot tell that from a press and used to strip
    // the category straight back out, leaving the URL describing a filter the list
    // was not applying.
    filterOptionState.value.categories = [{ id: "c1", name: "Groceries" }];
    const { rerender } = renderFilters({ ...baseFilters, type: "ALL" });

    rerender(
      <TransactionFiltersBar
        filters={{ ...baseFilters, type: "EXPENSE", categoryId: "c1" }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("Category: Groceries")).toBeTruthy();
  });
});

