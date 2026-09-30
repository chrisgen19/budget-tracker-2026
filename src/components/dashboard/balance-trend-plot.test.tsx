import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { BalanceTrendPlot } from "@/components/dashboard/balance-trend-plot";

// ResponsiveContainer measures its parent, which is 0x0 in jsdom, and then draws nothing.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 180 }),
  };
});

const rows = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  current: i < 15 ? 60_000 + i * 1_000 : undefined,
}));

const renderPlot = (hideAmounts: boolean) =>
  render(
    <BalanceTrendPlot
      rows={rows}
      compare={false}
      currentName="Sep"
      previousName="Aug"
      todayDay={15}
      daysInMonth={30}
      hideAmounts={hideAmounts}
      currency="PHP"
    />,
  );

const yTickLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value")).map(
    (tick) => tick.textContent,
  );

describe("BalanceTrendPlot", () => {
  it("labels the balance axis when amounts are shown", () => {
    const { container } = renderPlot(false);

    expect(yTickLabels(container).some((label) => label?.endsWith("K"))).toBe(true);
    expect(container.querySelector(".recharts-xAxis")?.textContent).toContain("Sep 15");
  });

  it("draws no balance axis labels under hide-amounts, since they would give the balance away", () => {
    const { container } = renderPlot(true);

    expect(yTickLabels(container)).toEqual([]);
  });
});
