import { describe, expect, it } from "vitest";
import { accountDateKey, accountMonthKey, combineAccountDateWithTime, formatAccountDateInput, isCalendarDay, relativeAccountDateInput } from "@/lib/account-time";

const INSTANT = new Date("2026-08-28T00:30:00.000Z");

describe("account time helpers", () => {
  it("formats an instant using the saved offset instead of the process timezone", () => {
    expect(formatAccountDateInput(INSTANT, -480)).toBe("2026-08-28T08:30");
    expect(formatAccountDateInput(INSTANT, 420)).toBe("2026-08-27T17:30");
  });

  it("derives account-local day and month keys across UTC boundaries", () => {
    const monthBoundary = new Date("2026-08-31T17:00:00.000Z");

    expect(accountDateKey(monthBoundary, -480)).toBe("2026-09-01");
    expect(accountMonthKey(monthBoundary, -480)).toBe("2026-09");
    expect(accountDateKey(monthBoundary, 420)).toBe("2026-08-31");
    expect(accountMonthKey(monthBoundary, 420)).toBe("2026-08");
  });

  it("combines a calendar date with the account clock rather than the browser clock", () => {
    expect(combineAccountDateWithTime("2026-09-05", INSTANT, -480)).toBe(
      "2026-09-05T08:30",
    );
    expect(combineAccountDateWithTime("2026-09-05T00:00:00.000Z", INSTANT, 420)).toBe(
      "2026-09-05T17:30",
    );
  });

  it("moves relative days on the account calendar without using local Date accessors", () => {
    expect(relativeAccountDateInput(INSTANT, -480, -1)).toBe("2026-08-27T08:30");
    expect(relativeAccountDateInput(INSTANT, 420, 1)).toBe("2026-08-28T17:30");
  });
});

describe("isCalendarDay", () => {
  it("accepts a real day and rejects a malformed one", () => {
    expect(isCalendarDay("2026-09-12")).toBe(true);
    expect(isCalendarDay("2026-9-1")).toBe(false);
    expect(isCalendarDay("2026-13-01")).toBe(false);
    expect(isCalendarDay("")).toBe(false);
  });

  it("rejects a well-formed day the calendar does not have", () => {
    // Date.UTC rolls these forward instead of failing, which is the whole reason
    // a format-only check is not enough.
    expect(isCalendarDay("2026-02-31")).toBe(false);
    expect(isCalendarDay("2026-04-31")).toBe(false);
    expect(isCalendarDay("2026-02-29")).toBe(false);
  });

  it("knows a leap day exists in a leap year", () => {
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2100-02-29")).toBe(false);
  });
});
