import { describe, expect, it } from "vitest";
import { getScheduledLabelId, type ScheduleRule } from "./schedule-matching";

const rule = (over: Partial<ScheduleRule> = {}): ScheduleRule => ({
  labelId: "work",
  labelCreatedAt: "2026-01-01T00:00:00Z",
  applicableTo: "EXPENSE",
  days: [1, 2, 3, 4, 5],
  startTime: "05:00",
  endTime: "17:00",
  ...over,
});

/** A moment on Monday 2026-09-07 at `time`, read at offset zero so the clock is exactly `time`. */
const monday = (time: string) => new Date(`2026-09-07T${time}:00.000Z`);

describe("getScheduledLabelId", () => {
  it("includes the start time and excludes the end time", () => {
    expect(getScheduledLabelId(monday("05:00"), 0, [rule()])).toBe("work");
    expect(getScheduledLabelId(monday("16:59"), 0, [rule()])).toBe("work");
    expect(getScheduledLabelId(monday("17:00"), 0, [rule()])).toBeNull();
  });

  it("checks the day and the transaction type", () => {
    expect(getScheduledLabelId(new Date("2026-09-12T10:00:00.000Z"), 0, [rule()])).toBeNull();
    expect(getScheduledLabelId(monday("10:00"), 0, [rule()], "INCOME")).toBeNull();
    expect(getScheduledLabelId(monday("10:00"), 0, [rule({ applicableTo: "BOTH" })], "INCOME")).toBe("work");
  });

  it("resolves the user's local day and time before matching", () => {
    // 02:00Z is 10:00 in UTC+8 (offset -480).
    const mondayMorningUtc8 = new Date("2026-09-07T02:00:00Z");
    expect(getScheduledLabelId(mondayMorningUtc8, -480, [rule()])).toBe("work");
    expect(getScheduledLabelId(mondayMorningUtc8, 0, [rule({ endTime: "02:00" })])).toBeNull();
  });

  it("picks the earliest-created label when several match", () => {
    const later = rule({ labelId: "later", labelCreatedAt: "2026-06-01T00:00:00Z" });
    expect(getScheduledLabelId(monday("10:00"), 0, [later, rule()])).toBe("work");
  });
});
