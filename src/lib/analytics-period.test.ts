import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_TIME_LABEL,
  chartGranularity,
  formatPeriodLabel,
  getCurrentMonth,
  monthRange,
  navigatePeriod,
  weekRange,
  weeksInMonth,
  yearRange,
} from "@/lib/analytics-period";

/** `Date#getTimezoneOffset` convention: UTC+8 is -480, UTC-8 is 480. */
const MANILA = -480;
const LOS_ANGELES = 480;

afterEach(() => {
  vi.useRealTimers();
});

describe("monthRange", () => {
  it("spans the first to the last day of the month", () => {
    expect(monthRange(2026, 8)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("knows February in both a leap and a common year", () => {
    expect(monthRange(2024, 1)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange(2026, 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("rolls the year for a month index outside 0-11", () => {
    expect(monthRange(2026, 12)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    expect(monthRange(2026, -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("yearRange", () => {
  it("spans January 1 to December 31", () => {
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("weekRange", () => {
  it("returns the Monday-to-Sunday week containing the day", () => {
    // 2026-09-10 is a Thursday.
    expect(weekRange("2026-09-10")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
  });

  it("treats Monday as the start of its own week", () => {
    expect(weekRange("2026-09-07")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
  });

  it("counts Sunday as the end of the week that began six days earlier", () => {
    // The trap in a Monday-start calendar: Sunday belongs to the *previous* Monday.
    expect(weekRange("2026-09-13")).toEqual({ from: "2026-09-07", to: "2026-09-13" });
  });

  it("spans a month and a year boundary", () => {
    expect(weekRange("2026-09-02")).toEqual({ from: "2026-08-31", to: "2026-09-06" });
    expect(weekRange("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });
});

describe("weeksInMonth", () => {
  it("lists every week overlapping the month, including the ones that straddle it", () => {
    expect(weeksInMonth(2026, 8)).toEqual([
      { from: "2026-08-31", to: "2026-09-06", label: "Aug 31 – Sep 6" },
      { from: "2026-09-07", to: "2026-09-13", label: "Sep 7 – Sep 13" },
      { from: "2026-09-14", to: "2026-09-20", label: "Sep 14 – Sep 20" },
      { from: "2026-09-21", to: "2026-09-27", label: "Sep 21 – Sep 27" },
      { from: "2026-09-28", to: "2026-10-04", label: "Sep 28 – Oct 4" },
    ]);
  });

  it("returns weeks in ascending order with no gaps", () => {
    const weeks = weeksInMonth(2026, 1);
    expect(weeks.length).toBeGreaterThan(0);
    weeks.forEach((week, index) => {
      expect(week.from < week.to).toBe(true);
      if (index > 0) {
        const previousSunday = new Date(`${weeks[index - 1].to}T00:00:00Z`);
        previousSunday.setUTCDate(previousSunday.getUTCDate() + 1);
        expect(week.from).toBe(previousSunday.toISOString().slice(0, 10));
      }
    });
  });
});

describe("getCurrentMonth", () => {
  it("resolves the month in the account's timezone, not the host's", () => {
    // 20:00 UTC on Aug 31 is already September in Manila but still August in LA.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T20:00:00Z"));
    expect(getCurrentMonth(MANILA)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(getCurrentMonth(LOS_ANGELES)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
});

describe("formatPeriodLabel", () => {
  it("labels All time without reading the dates", () => {
    expect(formatPeriodLabel("all", "", "")).toBe(ALL_TIME_LABEL);
  });

  it("labels a month, a year and a week", () => {
    expect(formatPeriodLabel("monthly", "2026-09-01", "2026-09-30")).toBe("September 2026");
    expect(formatPeriodLabel("yearly", "2026-01-01", "2026-12-31")).toBe("2026");
    expect(formatPeriodLabel("weekly", "2026-09-07", "2026-09-13")).toBe("Sep 7 – Sep 13, 2026");
  });

  it("labels a week that crosses a year boundary with both years", () => {
    expect(formatPeriodLabel("weekly", "2026-12-28", "2027-01-03")).toBe(
      "Dec 28, 2026 – Jan 3, 2027",
    );
  });

  it("promotes a custom range that covers a whole month or year", () => {
    expect(formatPeriodLabel("custom", "2026-02-01", "2026-02-28")).toBe("February 2026");
    expect(formatPeriodLabel("custom", "2026-01-01", "2026-12-31")).toBe("2026");
  });

  it("does not promote a range that only nearly covers the month", () => {
    expect(formatPeriodLabel("custom", "2026-02-01", "2026-02-27")).toBe("Feb 1 – Feb 27, 2026");
  });

  it("labels an arbitrary custom range", () => {
    expect(formatPeriodLabel("custom", "2026-08-15", "2026-09-14")).toBe("Aug 15 – Sep 14, 2026");
  });
});

describe("navigatePeriod", () => {
  it("steps a month across a year boundary in both directions", () => {
    expect(navigatePeriod("monthly", "2026-12-01", "2026-12-31", "next", MANILA)).toEqual({
      periodType: "monthly",
      from: "2027-01-01",
      to: "2027-01-31",
    });
    expect(navigatePeriod("monthly", "2026-01-01", "2026-01-31", "prev", MANILA)).toEqual({
      periodType: "monthly",
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("clamps to the length of the month it lands on", () => {
    expect(navigatePeriod("monthly", "2026-01-01", "2026-01-31", "next", MANILA)).toEqual({
      periodType: "monthly",
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("steps a year", () => {
    expect(navigatePeriod("yearly", "2026-01-01", "2026-12-31", "prev", MANILA)).toEqual({
      periodType: "yearly",
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("shifts a week by seven days across a month boundary", () => {
    expect(navigatePeriod("weekly", "2026-08-31", "2026-09-06", "next", MANILA)).toEqual({
      periodType: "weekly",
      from: "2026-09-07",
      to: "2026-09-13",
    });
  });

  it("navigates a whole-month custom range by the calendar, not by its day span", () => {
    // 31 days shifted arithmetically would land on Jan 31 – Mar 2.
    expect(navigatePeriod("custom", "2026-01-01", "2026-01-31", "next", MANILA)).toEqual({
      periodType: "custom",
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("navigates a whole-year custom range by the calendar", () => {
    expect(navigatePeriod("custom", "2026-01-01", "2026-12-31", "next", MANILA)).toEqual({
      periodType: "custom",
      from: "2027-01-01",
      to: "2027-12-31",
    });
  });

  it("shifts an arbitrary custom range by its own inclusive span", () => {
    expect(navigatePeriod("custom", "2026-09-01", "2026-09-10", "prev", MANILA)).toEqual({
      periodType: "custom",
      from: "2026-08-22",
      to: "2026-08-31",
    });
  });

  it("leaves All time for the account's current month, and reports the new type", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T20:00:00Z"));
    // Without the returned type the caller would stay on "all" and the next arrow
    // press would land on the current month again instead of advancing past it.
    expect(navigatePeriod("all", "", "", "next", MANILA)).toEqual({
      periodType: "monthly",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
});

describe("chartGranularity", () => {
  it("maps the fixed period types", () => {
    expect(chartGranularity("yearly", "2026-01-01", "2026-12-31")).toBe("monthly");
    expect(chartGranularity("monthly", "2026-09-01", "2026-09-30")).toBe("weekly");
    expect(chartGranularity("weekly", "2026-09-07", "2026-09-13")).toBe("weekly");
  });

  it("scales a custom range by its span", () => {
    expect(chartGranularity("custom", "2026-09-01", "2026-09-30")).toBe("weekly");
    expect(chartGranularity("custom", "2026-01-01", "2026-12-31")).toBe("monthly");
    expect(chartGranularity("custom", "2020-01-01", "2026-12-31")).toBe("yearly");
  });

  it("gives All time a defined answer even though analytics never selects it", () => {
    expect(chartGranularity("all", "", "")).toBe("monthly");
  });
});
