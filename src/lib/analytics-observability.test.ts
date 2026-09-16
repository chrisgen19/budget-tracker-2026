import { afterEach, describe, expect, it, vi } from "vitest";
import { logAnalyticsRequest } from "@/lib/analytics-observability";

describe("logAnalyticsRequest", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes only the allowlisted, rounded operational metrics", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logAnalyticsRequest({
      outcome: "success",
      durationMs: 12.7,
      databaseDurationMs: 4.2,
      fetchedRowCount: 8,
      bucketCount: 3,
      responseBytes: 1_024,
    });

    expect(info).toHaveBeenCalledWith(JSON.stringify({
      event: "analytics_request",
      outcome: "success",
      durationMs: 13,
      databaseDurationMs: 4,
      fetchedRowCount: 8,
      bucketCount: 3,
      responseBytes: 1_024,
    }));
  });
});
