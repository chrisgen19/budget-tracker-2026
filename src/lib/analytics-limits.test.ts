import { describe, expect, it } from "vitest";
import { analyticsRangeDays, countAnalyticsBuckets } from "@/lib/analytics-limits";

describe("analytics limits", () => {
  it("counts inclusive calendar days", () => {
    expect(analyticsRangeDays("2026-02-28", "2026-03-01")).toBe(2);
    expect(analyticsRangeDays("2024-02-28", "2024-03-01")).toBe(3);
  });

  it("counts the calendar buckets the charts would render", () => {
    expect(countAnalyticsBuckets("2026-01-01", "2026-12-31", "yearly")).toBe(1);
    expect(countAnalyticsBuckets("2026-01-01", "2026-12-31", "monthly")).toBe(12);
    expect(countAnalyticsBuckets("2026-01-01", "2026-01-11", "weekly")).toBe(2);
  });

  it("keeps a week whole when either endpoint falls within it", () => {
    expect(countAnalyticsBuckets("2026-01-05", "2026-01-11", "weekly")).toBe(1);
    expect(countAnalyticsBuckets("2026-01-11", "2026-01-12", "weekly")).toBe(2);
  });
});
