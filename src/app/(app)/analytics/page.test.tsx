import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnalyticsTabBar } from "@/app/(app)/analytics/page";

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
});
