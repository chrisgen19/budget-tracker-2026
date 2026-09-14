import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeatmapFooter } from "@/components/analytics/heatmap-footer";
import type { AnalyticsDailyItem } from "@/types";

/**
 * The heatmap's drill-down had no test of its own. What is worth pinning is not the
 * markup but the promise the row makes: the count it names is the count the ledger
 * will show, and the window it opens is that one day rather than the analytics
 * period the return link goes back to.
 */

const RETURN_TO = "period=monthly&from=2026-09-01&to=2026-09-30&type=EXPENSE&tab=reports";

const day = (over: Partial<AnalyticsDailyItem> = {}): AnalyticsDailyItem => ({
  date: "2026-09-12",
  income: 0,
  expenses: 1240,
  count: 3,
  ...over,
});

const plain = (value: number) => `PHP ${value}`;

const renderFooter = (props: Partial<Parameters<typeof HeatmapFooter>[0]> = {}) =>
  render(
    <HeatmapFooter
      mode="calendar"
      selected={day()}
      multiYear={false}
      fmt={plain}
      returnTo={RETURN_TO}
      {...props}
    />,
  );

const drillLink = () => screen.queryByRole("link", { name: /^View \d+ transactions? for / });

describe("HeatmapFooter", () => {
  it("opens the one day that was tapped, and carries the way back", () => {
    renderFooter();

    const link = drillLink();
    expect(link).not.toBeNull();
    // The e2e spec locates this row by exactly this name, so the phrasing is load
    // bearing rather than cosmetic.
    expect(link!.getAttribute("aria-label")).toBe("View 3 transactions for Sep 12");

    const url = new URL(link!.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/transactions");
    // A single day: both bounds are the tapped date. The period is "custom" because
    // what reaches the ledger is a pair of days, not a month it could recompute.
    expect(url.searchParams.get("from")).toBe("2026-09-12");
    expect(url.searchParams.get("to")).toBe("2026-09-12");
    expect(url.searchParams.get("period")).toBe("custom");
    // The window is one day while the way back is the whole analytics span, which is
    // why the two travel as separate params.
    expect(url.searchParams.get("ret")).toBe(RETURN_TO);
  });

  it("counts every transaction that day, not just the expenses", () => {
    renderFooter({ selected: day({ count: 1 }) });

    expect(drillLink()!.getAttribute("aria-label")).toBe("View 1 transaction for Sep 12");
    expect(screen.getByText(/1 txn$/)).toBeDefined();
  });

  it("offers no way in when the day has nothing behind it", () => {
    // A link promising zero rows is worse than no link: it lands on an empty list.
    renderFooter({ selected: day({ expenses: 0, count: 0 }) });

    expect(drillLink()).toBeNull();
    expect(screen.getByText(/nothing logged/)).toBeDefined();
  });

  it("offers no way in before a day is tapped", () => {
    renderFooter({ selected: null });

    expect(drillLink()).toBeNull();
    expect(screen.getByText("Tap a day for details")).toBeDefined();
  });

  it("offers no way in from a weekday average", () => {
    // A weekday cell is an average across many dates, so there is no single day to
    // open, and the filter params cannot express "every Tuesday" regardless. The
    // selection is deliberately non-null here: the mode alone has to suppress it.
    renderFooter({ mode: "weekday", selected: day() });

    expect(drillLink()).toBeNull();
    expect(screen.getByText("Average daily spend per weekday")).toBeDefined();
  });

  it("masks the amount but still names the count when amounts are hidden", () => {
    // The count is not a number worth hiding, and it is what the link promises.
    renderFooter({ fmt: () => "PHP ******" });

    expect(screen.getByText(/PHP \*\*\*\*\*\* spent/)).toBeDefined();
    expect(drillLink()!.getAttribute("aria-label")).toBe("View 3 transactions for Sep 12");
  });

  it("carries the year when the period spans more than one", () => {
    renderFooter({ multiYear: true });

    expect(drillLink()!.getAttribute("aria-label")).toBe("View 3 transactions for Sep 12, 2026");
  });
});
