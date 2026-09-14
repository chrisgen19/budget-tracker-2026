import { describe, expect, it } from "vitest";
import {
  coveragePercent,
  describePeriodProgress,
  localCalendarDay,
} from "@/lib/period-progress";

describe("describePeriodProgress", () => {
  it("counts only elapsed calendar days and marks today as still partial", () => {
    expect(describePeriodProgress("2026-09-01", "2026-09-30", "2026-09-15")).toEqual({
      isPartial: true,
      daysInPeriod: 30,
      daysElapsed: 15,
      effectiveTo: "2026-09-15",
    });
    expect(describePeriodProgress("2026-09-01", "2026-09-15", "2026-09-15").isPartial).toBe(true);
  });

  it("resolves today from the account timezone rather than the server timezone", () => {
    const instant = new Date("2026-08-31T20:00:00.000Z");
    expect(localCalendarDay(instant, -480)).toBe("2026-09-01");
    expect(localCalendarDay(instant, 480)).toBe("2026-08-31");
  });
});

describe("coveragePercent", () => {
  it("counts distinct logged days against days that could have data", () => {
    expect(coveragePercent(["2026-09-01", "2026-09-01", "2026-09-02"], 4)).toBe(50);
  });
});
