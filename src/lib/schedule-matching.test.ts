import { describe, expect, it } from "vitest";
import { getScheduledLabelId, scheduleRuleMatches, type ScheduleRule } from "./schedule-matching";

const rule = (over: Partial<ScheduleRule> = {}): ScheduleRule => ({
  labelId: "work",
  labelCreatedAt: "2026-01-01T00:00:00Z",
  applicableTo: "EXPENSE",
  days: [1, 2, 3, 4, 5],
  startTime: "05:00",
  endTime: "17:00",
  ...over,
});

describe("scheduleRuleMatches", () => {
  it("includes the start time and excludes the end time", () => {
    expect(scheduleRuleMatches(rule(), 1, "05:00")).toBe(true);
    expect(scheduleRuleMatches(rule(), 1, "16:59")).toBe(true);
    expect(scheduleRuleMatches(rule(), 1, "17:00")).toBe(false);
  });

  it("checks the day and the transaction type", () => {
    expect(scheduleRuleMatches(rule(), 6, "10:00")).toBe(false);
    expect(scheduleRuleMatches(rule(), 1, "10:00", "INCOME")).toBe(false);
    expect(scheduleRuleMatches(rule({ applicableTo: "BOTH" }), 1, "10:00", "INCOME")).toBe(true);
    expect(scheduleRuleMatches(rule(), 1, "10:00")).toBe(true);
  });
});

describe("getScheduledLabelId", () => {
  // 2026-09-07 02:00Z is Monday 10:00 in UTC+8 (offset -480).
  const mondayMorning = new Date("2026-09-07T02:00:00Z");

  it("resolves the user's local day and time before matching", () => {
    expect(getScheduledLabelId(mondayMorning, -480, [rule()])).toBe("work");
    expect(getScheduledLabelId(mondayMorning, 0, [rule({ startTime: "05:00", endTime: "06:00" })])).toBeNull();
  });

  it("picks the earliest-created label when several match", () => {
    const later = rule({ labelId: "later", labelCreatedAt: "2026-06-01T00:00:00Z" });
    expect(getScheduledLabelId(mondayMorning, -480, [later, rule()])).toBe("work");
  });
});
