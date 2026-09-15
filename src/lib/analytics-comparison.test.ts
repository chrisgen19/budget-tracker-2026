import { describe, expect, it } from "vitest";
import {
  buildAnalyticsPeriodContext,
  resolveAnalyticsPeriods,
} from "@/lib/analytics-comparison";

describe("resolveAnalyticsPeriods", () => {
  it("compares a running month through the same day of the prior month", () => {
    const result = resolveAnalyticsPeriods(
      { from: "2026-09-01", to: "2026-09-30" },
      "2026-09-15",
    );

    expect(result.current).toEqual({ from: "2026-09-01", to: "2026-09-15" });
    expect(result.previous).toEqual({ from: "2026-08-01", to: "2026-08-15" });
    expect(result.progress).toMatchObject({ isPartial: true, daysElapsed: 15, daysInPeriod: 30 });
  });

  it("compares finished calendar months in full", () => {
    const result = resolveAnalyticsPeriods(
      { from: "2026-08-01", to: "2026-08-31" },
      "2026-09-15",
    );

    expect(result.current).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(result.previous).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(result.progress.isPartial).toBe(false);
  });

  it("clamps a shorter comparison month instead of inventing February 30", () => {
    const result = resolveAnalyticsPeriods(
      { from: "2026-03-01", to: "2026-03-31" },
      "2026-03-30",
    );

    expect(result.current?.to).toBe("2026-03-30");
    expect(result.previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("clips a running year to the same calendar date in the prior year", () => {
    const result = resolveAnalyticsPeriods(
      { from: "2026-01-01", to: "2026-12-31" },
      "2026-09-15",
    );

    expect(result.current?.to).toBe("2026-09-15");
    expect(result.previous).toEqual({ from: "2025-01-01", to: "2025-09-15" });
  });

  it("uses equal elapsed spans for a partial custom range", () => {
    const result = resolveAnalyticsPeriods(
      { from: "2026-09-10", to: "2026-09-19" },
      "2026-09-15",
    );

    expect(result.current).toEqual({ from: "2026-09-10", to: "2026-09-15" });
    expect(result.previous).toEqual({ from: "2026-08-31", to: "2026-09-05" });
  });

  it("returns no current window for a wholly future range", () => {
    const result = resolveAnalyticsPeriods(
      { from: "2026-10-01", to: "2026-10-31" },
      "2026-09-15",
    );

    expect(result.current).toBeNull();
    expect(result.progress.daysElapsed).toBe(0);
  });
});

describe("buildAnalyticsPeriodContext", () => {
  const periods = resolveAnalyticsPeriods(
    { from: "2026-09-01", to: "2026-09-30" },
    "2026-09-05",
  );

  it("allows comparison only when both windows pass the shared coverage gate", () => {
    const context = buildAnalyticsPeriodContext(
      periods,
      ["2026-09-01", "2026-09-02", "2026-09-03"],
      ["2026-08-01", "2026-08-02", "2026-08-03"],
      3,
    );

    expect(context.comparisonStatus).toBe("available");
    expect(context.currentCoveragePct).toBe(60);
    expect(context.previousCoveragePct).toBe(60);
  });

  it("withholds a comparison whose logging coverage is too low", () => {
    const context = buildAnalyticsPeriodContext(
      periods,
      ["2026-09-01"],
      ["2026-08-01", "2026-08-02", "2026-08-03"],
      3,
    );

    expect(context.comparisonStatus).toBe("low-coverage");
    expect(context.currentCoveragePct).toBe(20);
  });

  it("withholds fractional coverage that would round up to the threshold", () => {
    const longPeriods = resolveAnalyticsPeriods(
      { from: "2026-09-01", to: "2026-10-22" },
      "2026-10-22",
    );
    const currentDays = Array.from({ length: 31 }, (_, index) => `current-${index}`);
    const previousDays = Array.from({ length: 32 }, (_, index) => `previous-${index}`);
    const context = buildAnalyticsPeriodContext(
      longPeriods,
      currentDays,
      previousDays,
      previousDays.length,
    );

    expect(context.currentCoveragePct).toBe(59);
    expect(context.comparisonStatus).toBe("low-coverage");
  });
});
