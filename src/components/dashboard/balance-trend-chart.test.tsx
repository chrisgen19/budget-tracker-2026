import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BalanceTrendChart, COMPARE_STORAGE_KEY } from "@/components/dashboard/balance-trend-chart";
import type { BalanceMonth } from "@/types";

// Recharts measures its container, which jsdom cannot; the plot has its own test.
vi.mock("@/components/dashboard/balance-trend-plot", () => ({
  PREVIOUS_MONTH_COLOR: "#B5A898",
  BalanceTrendPlot: (props: { compare: boolean; todayDay: number | null }) => (
    <div data-testid="plot" data-compare={String(props.compare)} data-today={String(props.todayDay)} />
  ),
}));

const MANILA = -480;

const makeMonth = (month: string, openingBalance: number, deltas: Record<number, number> = {}): BalanceMonth => {
  const [year, monthNumber] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let balance = openingBalance;
  const days = Array.from({ length }, (_, i) => {
    balance += deltas[i + 1] ?? 0;
    return { date: `${month}-${String(i + 1).padStart(2, "0")}`, balance };
  });
  return { month, openingBalance, days };
};

// Aug gains 20,000 by the 15th and 12,000 over the month; Sep gains 16,000 by the 15th and 15,000
// over the month.
const months = {
  previous: makeMonth("2026-08", 50_000, { 5: 20_000, 20: -8_000 }),
  current: makeMonth("2026-09", 62_000, { 5: 20_000, 10: -4_000, 25: -1_000 }),
};

const renderChart = (hideAmounts = false) =>
  render(<BalanceTrendChart months={months} hideAmounts={hideAmounts} timezoneOffset={MANILA} currency="PHP" />);

const compareToggle = () => screen.getByRole("button", { name: "Compare vs Aug" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-15T04:00:00.000Z")); // noon on Sep 15 in Manila
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BalanceTrendChart", () => {
  it("states today's balance and the change since the 1st in pesos, not a percentage", () => {
    renderChart();

    expect(screen.getByText("Balance today")).toBeTruthy();
    expect(screen.getByText("₱78,000.00")).toBeTruthy();
    expect(screen.getByText("+₱16,000.00")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole("link", { name: /See forecast/ }).getAttribute("href")).toBe("/analytics?tab=forecast");
  });

  it("marks today on the user's calendar, not the UTC one", () => {
    // 16:30 UTC on Sep 14 is already 00:30 on Sep 15 in Manila.
    vi.setSystemTime(new Date("2026-09-14T16:30:00.000Z"));
    renderChart();

    expect(screen.getByTestId("plot").getAttribute("data-today")).toBe("15");
    expect(screen.getByText("₱78,000.00")).toBeTruthy();
  });

  it("overlays last month on demand and remembers the choice", () => {
    renderChart();
    expect(compareToggle().getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("plot").getAttribute("data-compare")).toBe("false");

    fireEvent.click(compareToggle());

    expect(compareToggle().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("plot").getAttribute("data-compare")).toBe("true");
    expect(screen.getByText("₱4,000.00 behind Aug at this point")).toBeTruthy();
    expect(localStorage.getItem(COMPARE_STORAGE_KEY)).toBe("1");
  });

  it("opens already comparing when this device remembered it", () => {
    localStorage.setItem(COMPARE_STORAGE_KEY, "1");
    renderChart();

    expect(compareToggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("still works when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderChart();

    fireEvent.click(compareToggle());
    expect(compareToggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("masks every figure under hide-amounts and keeps only the direction", () => {
    localStorage.setItem(COMPARE_STORAGE_KEY, "1");
    renderChart(true);

    expect(screen.queryByText(/78,000/)).toBeNull();
    expect(screen.queryByText(/16,000/)).toBeNull();
    expect(screen.queryByText(/4,000/)).toBeNull();
    expect(screen.getByText("Behind Aug at this point")).toBeTruthy();
  });

  it("labels a finished month by its end and compares whole months", () => {
    vi.setSystemTime(new Date("2026-10-02T04:00:00.000Z"));
    localStorage.setItem(COMPARE_STORAGE_KEY, "1");
    renderChart();

    expect(screen.getByText("End of Sep")).toBeTruthy();
    expect(screen.getByText("₱77,000.00")).toBeTruthy();
    expect(screen.getByText("Sep ended ₱3,000.00 ahead of Aug")).toBeTruthy();
    expect(screen.getByTestId("plot").getAttribute("data-today")).toBe("null");
    expect(screen.queryByRole("link", { name: /See forecast/ })).toBeNull();
  });

  it("says a month still ahead has not started instead of drawing it", () => {
    vi.setSystemTime(new Date("2026-08-20T04:00:00.000Z"));
    renderChart();

    expect(screen.getByText("Sep hasn't started yet")).toBeTruthy();
    expect(screen.queryByTestId("plot")).toBeNull();
    expect(screen.queryByRole("button", { name: "Compare vs Aug" })).toBeNull();
  });
});
