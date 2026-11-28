import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { CashFlowChart } from "@/components/analytics/cash-flow-chart";
import type { AnalyticsCashFlowItem } from "@/types";

// ResponsiveContainer measures its parent, which is 0x0 in jsdom, and then draws nothing.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 220 }),
  };
});

const data: AnalyticsCashFlowItem[] = [
  { period: "2026-09", periodLabel: "Sep 2026", income: 60_000, expenses: 40_000, net: 20_000, cumulativeNet: 20_000 },
  { period: "2026-10", periodLabel: "Oct 2026", income: 55_000, expenses: 50_000, net: 5_000, cumulativeNet: 25_000 },
  { period: "2026-11", periodLabel: "Nov 2026", income: 50_000, expenses: 58_000, net: -8_000, cumulativeNet: 17_000 },
];

const yTicks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value")).map(
    (t) => t.textContent ?? "",
  );

describe("CashFlowChart", () => {
  it("labels the Y-axis with abbreviated amounts when amounts are shown", () => {
    const { container } = render(<CashFlowChart data={data} currency="PHP" hideAmounts={false} />);
    const ticks = yTicks(container);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.some((t) => /\dK$/.test(t))).toBe(true);
  });

  it("hides every Y-axis tick label when hideAmounts", () => {
    // The tooltip was already masked; the axis gave the same amounts away to the nearest thousand.
    const { container } = render(<CashFlowChart data={data} currency="PHP" hideAmounts />);
    const ticks = yTicks(container);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t === "")).toBe(true);
  });
});
