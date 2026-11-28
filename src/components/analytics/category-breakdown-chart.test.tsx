import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryBreakdownChart, CategorySliceTooltip } from "@/components/analytics/category-breakdown-chart";
import type { AnalyticsCategoryItem } from "@/types";

// ResponsiveContainer measures its parent, which is 0x0 in jsdom, and then draws nothing.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 180 }),
  };
});

const range = { from: "2026-11-01", to: "2026-11-30" };

const item: AnalyticsCategoryItem = {
  id: "c1",
  name: "Food",
  color: "#C44B3F",
  icon: "utensils",
  amount: 1234,
  percentage: 100,
  type: "EXPENSE",
  transactionCount: 2,
};

describe("CategoryBreakdownChart", () => {
  it("omits ret when returnTo is not given", () => {
    render(<CategoryBreakdownChart data={[item]} currency="PHP" hideAmounts={false} range={range} />);
    const href = screen.getByRole("link").getAttribute("href") ?? "";
    expect(href).toContain("categoryId=c1");
    expect(href).toContain("type=EXPENSE");
    expect(href).toContain("from=2026-11-01");
    expect(href).toContain("to=2026-11-30");
    expect(href).not.toContain("ret=");
  });

  it("uses the custom empty copy", () => {
    render(
      <CategoryBreakdownChart
        data={[]}
        currency="PHP"
        hideAmounts={false}
        range={range}
        emptyMessage="No expenses this month"
      />,
    );
    expect(screen.getByText("No expenses this month")).toBeTruthy();
  });

  it("masks amounts when hideAmounts", () => {
    const { container } = render(
      <CategoryBreakdownChart data={[item]} currency="PHP" hideAmounts range={range} />,
    );
    expect(container.textContent).not.toContain("1,234");
    expect(container.textContent).toContain("••••");
  });
});

describe("CategorySliceTooltip", () => {
  it("uses the singular for a category with one transaction", () => {
    render(<CategorySliceTooltip item={{ ...item, transactionCount: 1 }} currency="PHP" hideAmounts={false} />);
    expect(screen.getByText("1 transaction")).toBeTruthy();
    expect(screen.queryByText("1 transactions")).toBeNull();
  });

  it("uses the plural otherwise", () => {
    render(<CategorySliceTooltip item={{ ...item, transactionCount: 2 }} currency="PHP" hideAmounts={false} />);
    expect(screen.getByText("2 transactions")).toBeTruthy();
  });

  it("masks the amount but keeps the share when hideAmounts", () => {
    render(<CategorySliceTooltip item={item} currency="PHP" hideAmounts />);
    expect(screen.getByText(/•••••• \(100%\)/)).toBeTruthy();
    expect(screen.queryByText(/1,234/)).toBeNull();
  });
});
