import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnalyticsTabBar } from "@/components/analytics/analytics-tab-bar";

/**
 * The tab strip had no test, and its buttons were 36px tall on mobile and 32px
 * from `sm:` up for as long as it has existed -- the padding shrinks at that
 * breakpoint faster than the text grows. Nobody noticed until a sixth tab was
 * added next to it, which is the same way #212 found every switch on the profile
 * page at once.
 *
 * The assertion loops over whatever `role="tab"` renders rather than naming the
 * five tabs, so a tab added later is covered without touching this file. It pins
 * the class and not a measured height because jsdom computes no layout, matching
 * how the sibling type filter is pinned (`analytics-reports.test.tsx`).
 *
 * The component sits here rather than in `analytics/page.tsx` because a page
 * module may only export the fields Next.js recognises: exporting it from there
 * to make it reachable passed `tsc --noEmit` and broke `next build`.
 */
describe("AnalyticsTabBar", () => {
  it("gives every tab the 44px minimum touch target", () => {
    render(
      <AnalyticsTabBar
        activeTab="reports"
        onSelect={vi.fn()}
        layoutId="analytics-tabs-test"
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(1);

    for (const tab of tabs) {
      expect(tab.className).toContain("min-h-11");
    }
  });

  /**
   * `/analytics` is open to everyone; cards are admin-only until an admin flips the switch. A Debt
   * tab that renders and then answers 403 is worse than no tab, so it is not rendered at all.
   */
  it("hides the Debt tab from a user without credit card access", () => {
    render(<AnalyticsTabBar activeTab="reports" onSelect={vi.fn()} layoutId="t1" />);
    expect(screen.queryByRole("tab", { name: /debt/i })).toBeNull();
  });

  it("shows it to a user who has access", () => {
    render(<AnalyticsTabBar activeTab="reports" onSelect={vi.fn()} layoutId="t2" showCards />);
    expect(screen.getByRole("tab", { name: /debt/i })).toBeDefined();
  });

  /** Gating one tab must not cost anyone the rest of the bar. */
  it("keeps every other tab either way", () => {
    const { unmount } = render(<AnalyticsTabBar activeTab="reports" onSelect={vi.fn()} layoutId="t3" />);
    const without = screen.getAllByRole("tab").length;
    unmount();
    render(<AnalyticsTabBar activeTab="reports" onSelect={vi.fn()} layoutId="t4" showCards />);
    expect(screen.getAllByRole("tab").length).toBe(without + 1);
  });

  /**
   * The bar is one scrolling row now, so tabs past the edge are off screen. Arrow keys
   * are how a keyboard user reaches them, and only the active tab sits in the Tab order
   * so the row is one stop rather than eight.
   */
  it("keeps only the active tab in the Tab order", () => {
    render(<AnalyticsTabBar activeTab="forecast" onSelect={vi.fn()} layoutId="t5" />);
    const focusable = screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0);
    expect(focusable).toHaveLength(1);
    expect(focusable[0].getAttribute("aria-selected")).toBe("true");
  });

  it("moves to the next and previous tab with the arrow keys, wrapping at the ends", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <AnalyticsTabBar activeTab="reports" onSelect={onSelect} layoutId="t6" />,
    );
    const tablist = screen.getByRole("tablist");

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("budget");

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("ai-assessment");

    rerender(<AnalyticsTabBar activeTab="ai-assessment" onSelect={onSelect} layoutId="t6" />);
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("reports");
  });

  it("jumps to the first and last tab with Home and End", () => {
    const onSelect = vi.fn();
    render(<AnalyticsTabBar activeTab="watchlist" onSelect={onSelect} layoutId="t7" />);
    const tablist = screen.getByRole("tablist");

    fireEvent.keyDown(tablist, { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("ai-assessment");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith("reports");
  });

  /**
   * The page rewrites an excluded user's `?tab=debt` to Reports, but the bar must survive
   * without that: with the active tab filtered out, no tab had tabIndex 0, so the row could
   * not be reached with Tab at all, and ArrowRight stepped from index 0 to the second tab.
   */
  it("keeps the row reachable when the active tab is filtered out", () => {
    const onSelect = vi.fn();
    render(<AnalyticsTabBar activeTab="debt" onSelect={onSelect} layoutId="t9" />);

    const focusable = screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0);
    expect(focusable).toHaveLength(1);
    expect(focusable[0].textContent).toMatch(/reports/i);

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("reports");
  });

  /** Arrowing must skip a tab the user cannot see, not land on it. */
  it("skips the hidden Debt tab when arrowing", () => {
    const onSelect = vi.fn();
    render(<AnalyticsTabBar activeTab="forecast" onSelect={onSelect} layoutId="t8" />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("watchlist");
  });
});
