import { afterAll, describe, expect, it } from "vitest";
import { formatDayKey, formatMonthKey, shiftMonthKey } from "./month-key";

// West of UTC, so a key formatted in the process zone instead of UTC would show the previous day.
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/Los_Angeles";
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("shiftMonthKey", () => {
  it("moves within a year", () => {
    expect(shiftMonthKey("2026-08", 1)).toBe("2026-09");
    expect(shiftMonthKey("2026-08", -1)).toBe("2026-07");
  });

  it("crosses year boundaries in both directions", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });
});

describe("formatting", () => {
  it("names the month the key names", () => {
    expect(formatMonthKey("2026-08")).toBe("August 2026");
  });

  it("names the day the key names, not the day before", () => {
    expect(formatDayKey("2026-08-25")).toBe("Aug 25");
  });
});
