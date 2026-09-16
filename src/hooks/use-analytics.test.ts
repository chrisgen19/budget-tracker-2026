import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnalyticsRequestError,
  fetchAnalytics,
  shouldRetryAnalyticsRequest,
} from "@/hooks/use-analytics";

afterEach(() => vi.unstubAllGlobals());

describe("fetchAnalytics", () => {
  it("preserves a validation message from the analytics API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { to: ["Date range cannot exceed 3,660 days"] },
    }), { status: 400 })));

    await expect(fetchAnalytics({
      granularity: "yearly",
      from: "2015-01-01",
      to: "2026-01-01",
      type: "EXPENSE",
    }, -480)).rejects.toMatchObject({
      message: "Date range cannot exceed 3,660 days",
      status: 400,
    });
  });

  it("does not retry an actionable client refusal", () => {
    expect(shouldRetryAnalyticsRequest(0, new AnalyticsRequestError("Date range cannot exceed 3,660 days", 400))).toBe(false);
    expect(shouldRetryAnalyticsRequest(0, new Error("Network error"))).toBe(true);
    expect(shouldRetryAnalyticsRequest(1, new Error("Network error"))).toBe(false);
  });
});
