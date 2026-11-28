import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlyTrendChart } from "@/components/dashboard/monthly-trend-chart";
import { formatCurrency, getCurrencySymbol } from "@/lib/utils";
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
});
