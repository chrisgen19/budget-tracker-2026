import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { CategoryTrendsChart } from "@/components/analytics/category-trends-chart";
import type { AnalyticsCategoryTrends } from "@/types";

// ResponsiveContainer measures its parent, which is 0x0 in jsdom, and then draws nothing.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 260 }),
  };
});

const data: AnalyticsCategoryTrends = {
  series: [
    { id: "food", name: "Food & Dining", color: "#C8702A", icon: "utensils", total: 39_000 },
    { id: "transport", name: "Transportation", color: "#5B8DEF", icon: "car", total: 15_000 },
  ],
  points: [
    { period: "2026-09", periodLabel: "Sep 2026", values: { food: 12_000, transport: 4_000 } },
    { period: "2026-10", periodLabel: "Oct 2026", values: { food: 14_000, transport: 5_000 } },
    { period: "2026-11", periodLabel: "Nov 2026", values: { food: 13_000, transport: 6_000 } },
  ],
};

const yTicks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value")).map(
    (t) => t.textContent ?? "",
  );

describe("CategoryTrendsChart", () => {
  it("labels the Y-axis with abbreviated amounts when amounts are shown", () => {
    const { container } = render(<CategoryTrendsChart data={data} currency="PHP" hideAmounts={false} />);
    const ticks = yTicks(container);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.some((t) => /\dK$/.test(t))).toBe(true);
  });

  it("hides every Y-axis tick label when hideAmounts", () => {
    // The tooltip was already masked; the axis gave the same amounts away to the nearest thousand.
    const { container } = render(<CategoryTrendsChart data={data} currency="PHP" hideAmounts />);
    const ticks = yTicks(container);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t === "")).toBe(true);
  });
});
