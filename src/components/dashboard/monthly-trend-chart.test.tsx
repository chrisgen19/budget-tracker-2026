import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MonthlyTrendChart, resolveSelectedMonth } from "@/components/dashboard/monthly-trend-chart";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
import { formatAbbreviated } from "@/components/analytics/chart-theme";
import type { MonthlyTrendItem } from "@/types";

// ResponsiveContainer measures its parent, which is 0x0 in jsdom, and then draws nothing.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 220 }),
  };
});

const KEYS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const LABELS = ["Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026", "Nov 2026"];

const makeData = (last: Partial<MonthlyTrendItem> = {}): MonthlyTrendItem[] =>
  KEYS.map((monthKey, i) => ({
    month: LABELS[i],
    monthKey,
    income: 1000 * (i + 1),
    expenses: 500 * (i + 1),
    transactionCount: 2,
    ...(i === KEYS.length - 1 ? last : {}),
  }));

describe("MonthlyTrendChart", () => {
  it("defaults the footer to the latest month", () => {
    render(<MonthlyTrendChart data={makeData({ transactionCount: 4 })} currency="PHP" hideAmounts={false} />);
    const link = screen.getByRole("link", { name: "View 4 transactions for November 2026" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("from=2026-11-01");
    expect(href).toContain("to=2026-11-30");
    expect(href).not.toContain("type=");
    expect(href).not.toContain("ret=");
  });

  it("masks footer totals when hideAmounts", () => {
    render(
      <MonthlyTrendChart
        data={makeData({ income: 1234.5, transactionCount: 4 })}
        currency="PHP"
        hideAmounts
      />,
    );
    expect(screen.getAllByText(`${getCurrencySymbol("PHP")} ••••••`).length).toBeGreaterThan(0);
    expect(screen.queryByText(formatCurrency(1234.5, "PHP"))).toBeNull();
  });

  it("shows no link for a month with no transactions", () => {
    render(
      <MonthlyTrendChart
        data={makeData({ income: 0, expenses: 0, transactionCount: 0 })}
        currency="PHP"
        hideAmounts={false}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("No transactions")).toBeTruthy();
  });

  it("renders the empty state when every month is zero", () => {
    const data = makeData().map((m) => ({ ...m, income: 0, expenses: 0, transactionCount: 0 }));
    render(<MonthlyTrendChart data={data} currency="PHP" hideAmounts={false} />);
    expect(screen.getByText("No data yet")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("hides Y-axis tick labels when hideAmounts", () => {
    const tick = formatAbbreviated(6000);
    const { container, unmount } = render(
      <MonthlyTrendChart data={makeData()} currency="PHP" hideAmounts={false} />,
    );
    const ticks = () => Array.from(container.querySelectorAll(".recharts-yAxis text")).map((t) => t.textContent);
    expect(ticks()).toContain(tick);
    unmount();
    const hidden = render(<MonthlyTrendChart data={makeData()} currency="PHP" hideAmounts />);
    const hiddenTicks = Array.from(hidden.container.querySelectorAll(".recharts-yAxis text")).map((t) => t.textContent);
    expect(hiddenTicks).not.toContain(tick);
  });
});

describe("MonthlyTrendChart keyboard selection", () => {
  const chart = () => screen.getByRole("group", { name: /monthly trend/i });
  const footerLink = () => screen.getByRole("link", { name: /^View \d+ transactions? for / });

  it("is a focusable group that says how to choose a month", () => {
    render(<MonthlyTrendChart data={makeData()} currency="PHP" hideAmounts={false} />);
    expect(chart().tabIndex).toBe(0);
    expect(chart().getAttribute("aria-label")).toMatch(/arrow keys/i);
  });

  it("moves the selected month with the arrow keys and stops at either end", () => {
    render(<MonthlyTrendChart data={makeData()} currency="PHP" hideAmounts={false} />);
    fireEvent.keyDown(chart(), { key: "ArrowLeft" });
    expect(footerLink().getAttribute("aria-label")).toBe("View 2 transactions for October 2026");
    fireEvent.keyDown(chart(), { key: "Home" });
    expect(footerLink().getAttribute("aria-label")).toBe("View 2 transactions for June 2026");
    fireEvent.keyDown(chart(), { key: "ArrowLeft" });
    expect(footerLink().getAttribute("aria-label")).toBe("View 2 transactions for June 2026");
    fireEvent.keyDown(chart(), { key: "End" });
    fireEvent.keyDown(chart(), { key: "ArrowRight" });
    expect(footerLink().getAttribute("aria-label")).toBe("View 2 transactions for November 2026");
  });

  it("returns to the newest month when the dashboard window moves under a kept-mounted chart", () => {
    const octoberWindow = makeData().map((m, i) => ({ ...m, monthKey: `2026-${String(i + 5).padStart(2, "0")}` }));
    const { rerender } = render(<MonthlyTrendChart data={octoberWindow} currency="PHP" hideAmounts={false} />);
    fireEvent.keyDown(chart(), { key: "Home" }); // May
    fireEvent.keyDown(chart(), { key: "ArrowRight" });
    fireEvent.keyDown(chart(), { key: "ArrowRight" }); // July
    expect(footerLink().getAttribute("aria-label")).toBe("View 2 transactions for July 2026");
    rerender(<MonthlyTrendChart data={makeData()} currency="PHP" hideAmounts={false} />);
    expect(footerLink().getAttribute("aria-label")).toBe("View 2 transactions for November 2026");
  });
});

describe("resolveSelectedMonth", () => {
  // The window the dashboard shows for October: May to October.
  const octoberWindow = makeData().map((m, i) => ({ ...m, monthKey: `2026-${String(i + 5).padStart(2, "0")}` }));
  const novemberWindow = makeData();

  it("defaults to the newest month when nothing is selected", () => {
    expect(resolveSelectedMonth(null, novemberWindow).monthKey).toBe("2026-11");
  });

  it("keeps a month picked within the same window", () => {
    const picked = { anchorKey: "2026-11", monthKey: "2026-07" };
    expect(resolveSelectedMonth(picked, novemberWindow).monthKey).toBe("2026-07");
  });

  it("drops a pick made in another window, even when that window still contains the month", () => {
    // July was picked while the dashboard showed October; stepping to November keeps the
    // chart mounted when November is cached, and July is still one of its six months.
    const picked = { anchorKey: octoberWindow[octoberWindow.length - 1].monthKey, monthKey: "2026-07" };
    expect(resolveSelectedMonth(picked, novemberWindow).monthKey).toBe("2026-11");
  });

  it("falls back to the newest month when the picked one is no longer in the data", () => {
    const picked = { anchorKey: "2026-11", monthKey: "2026-01" };
    expect(resolveSelectedMonth(picked, novemberWindow).monthKey).toBe("2026-11");
  });
});
