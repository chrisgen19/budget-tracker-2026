import { afterAll, describe, it, expect } from "vitest";
import {
  computeNextDueDate,
  advanceToNextUnpaidOccurrence,
  describeDueDate,
  formatBillDate,
} from "./bill-utils";
import { addUtcDays, userToday, utcDayStart } from "./bill-dates";

/** Bill dates are date-only values stored at midnight UTC. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const key = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("computeNextDueDate", () => {
  it("advances daily, weekly and custom intervals", () => {
    expect(key(computeNextDueDate(day("2026-08-31"), "DAILY", 31))).toBe("2026-09-01");
    expect(key(computeNextDueDate(day("2026-08-28"), "WEEKLY", 28))).toBe("2026-09-04");
    expect(key(computeNextDueDate(day("2026-08-28"), "CUSTOM", 28, 10))).toBe("2026-09-07");
  });

  it("advances monthly, keeping the original day of month", () => {
    expect(key(computeNextDueDate(day("2026-08-05"), "MONTHLY", 5))).toBe("2026-09-05");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(key(computeNextDueDate(day("2026-01-31"), "MONTHLY", 31))).toBe("2026-02-28");
  });

  it("does not skip February from a 31st", () => {
    // `setMonth(+1)` on 31 January overflows to 3 March, and the clamp then reads March's
    // length and returns 31 March — a monthly bill silently missing an occurrence.
    const next = computeNextDueDate(day("2026-01-31"), "MONTHLY", 31);
    expect(key(next)).not.toBe("2026-03-31");
    expect(next.getUTCMonth()).toBe(1);
  });

  it("rolls the year over in December", () => {
    expect(key(computeNextDueDate(day("2026-12-15"), "MONTHLY", 15))).toBe("2027-01-15");
  });

  it("turns 29 February into 28 February in a non-leap year", () => {
    expect(key(computeNextDueDate(day("2028-02-29"), "ANNUALLY", 29))).toBe("2029-02-28");
  });

  it("keeps every result at midnight UTC", () => {
    for (const freq of ["DAILY", "WEEKLY", "MONTHLY", "ANNUALLY"] as const) {
      const next = computeNextDueDate(day("2026-08-05"), freq, 5);
      expect(next.toISOString()).toMatch(/T00:00:00\.000Z$/);
    }
  });
});

describe("advanceToNextUnpaidOccurrence", () => {
  it("returns the starting date when nothing is settled", () => {
    expect(key(advanceToNextUnpaidOccurrence(day("2026-08-05"), "MONTHLY", 5, null, []))).toBe(
      "2026-08-05"
    );
  });

  it("walks past paid and skipped occurrences", () => {
    const next = advanceToNextUnpaidOccurrence(day("2026-08-05"), "MONTHLY", 5, null, [
      { dueDate: day("2026-08-05"), status: "PAID" },
      { dueDate: day("2026-09-05"), status: "SKIPPED" },
    ]);
    expect(key(next)).toBe("2026-10-05");
  });

  it("ignores a snooze, which does not settle an occurrence", () => {
    const next = advanceToNextUnpaidOccurrence(day("2026-08-05"), "MONTHLY", 5, null, [
      { dueDate: day("2026-08-05"), status: "SNOOZED" },
    ]);
    expect(key(next)).toBe("2026-08-05");
  });

  it("returns null past the end date", () => {
    const next = advanceToNextUnpaidOccurrence(
      day("2026-08-05"),
      "MONTHLY",
      5,
      null,
      [{ dueDate: day("2026-08-05"), status: "PAID" }],
      { endDate: day("2026-08-20") }
    );
    expect(next).toBeNull();
  });

  it("matches a settled occurrence stored with a stray time component", () => {
    // A row written by an older path may not sit exactly on midnight. Matching is by calendar
    // day, so it must still count as settled rather than being advanced past twice.
    const next = advanceToNextUnpaidOccurrence(day("2026-08-05"), "MONTHLY", 5, null, [
      { dueDate: new Date("2026-08-05T09:30:00.000Z"), status: "PAID" },
    ]);
    expect(key(next)).toBe("2026-09-05");
  });
});

describe("the UTC date helpers", () => {
  it("truncates to the UTC calendar day", () => {
    expect(utcDayStart(new Date("2026-08-05T23:59:59.999Z")).toISOString()).toBe(
      "2026-08-05T00:00:00.000Z"
    );
  });

  it("adds and subtracts whole days without touching the time", () => {
    expect(key(addUtcDays(day("2026-03-01"), -1))).toBe("2026-02-28");
    expect(key(addUtcDays(day("2026-12-31"), 1))).toBe("2027-01-01");
  });
});

describe("originalStartDay must be read in UTC", () => {
  it("advances to the 31st, not the 30th, when the start date is read in UTC", () => {
    const start = day("2026-01-31");
    // getUTCDate() is 31; a local getDate() on a host behind UTC reads 30 and the bill would
    // then advance to the 30th of every later month.
    expect(key(computeNextDueDate(day("2026-03-31"), "MONTHLY", start.getUTCDate()))).toBe(
      "2026-04-30"
    );
    expect(key(computeNextDueDate(day("2026-04-30"), "MONTHLY", start.getUTCDate()))).toBe(
      "2026-05-31"
    );
  });
});

describe("userToday", () => {
  it("is the user's calendar day, not UTC's, between their midnight and UTC's", () => {
    // 02:00 on 30 August in Manila is still 29 August in UTC.
    const now = new Date("2026-08-29T18:00:00.000Z");
    expect(key(userToday(-480, now))).toBe("2026-08-30");
    expect(key(utcDayStart(now))).toBe("2026-08-29");
  });

  it("is the previous day for a user behind UTC after their midnight has passed in UTC", () => {
    // 21:00 on 29 August in New York is already 30 August in UTC.
    const now = new Date("2026-08-30T01:00:00.000Z");
    expect(key(userToday(240, now))).toBe("2026-08-29");
    expect(key(utcDayStart(now))).toBe("2026-08-30");
  });

  it("encodes the result at UTC midnight, so it can be stored as a due date", () => {
    expect(userToday(-480, new Date("2026-08-29T18:00:00.000Z")).toISOString()).toBe(
      "2026-08-30T00:00:00.000Z"
    );
  });

  it("gives a snooze the user's full N days rather than expiring the same morning", () => {
    // The reported failure: snoozing one day at 02:00 Manila. Off the raw clock the target is
    // 30 August 00:00Z, which is 08:00 that same morning for them.
    const now = new Date("2026-08-29T18:00:00.000Z");
    expect(key(addUtcDays(userToday(-480, now), 1))).toBe("2026-08-31");
    expect(key(addUtcDays(utcDayStart(now), 1))).toBe("2026-08-30");
  });
});

/*
 * Both helpers render values a browser reads, so the browser zone is forced to one west of UTC
 * for the whole block: east of Greenwich (where this repo is developed) a browser-local reading
 * of a UTC-midnight anchor lands on the right day by luck and proves nothing.
 */
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/Los_Angeles";

/**
 * Restore the ambient zone.
 *
 * `process.env.TZ = undefined` writes the *string* "undefined", which is not a zone: Node falls
 * back to UTC and the machine's real offset is gone for everything that runs afterwards. TZ is
 * usually unset here (the zone comes from /etc/localtime), so that is the common case, not the
 * corner one.
 */
const restoreTimeZone = () => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
};

afterAll(restoreTimeZone);

describe("formatBillDate", () => {
  it("renders the stored calendar day, not the browser's reading of it", () => {
    expect(formatBillDate("2026-09-05T00:00:00.000Z")).toBe("Sep 5, 2026");
  });

  it("does not roll a first-of-month back into the previous month", () => {
    expect(formatBillDate("2026-09-01T00:00:00.000Z")).toBe("Sep 1, 2026");
  });
});

describe("describeDueDate", () => {
  const due = day("2026-09-05");

  /*
   * Every `now` below is chosen so the browser's calendar day and the account's disagree.
   * Truncating both sides in the browser shifts them together and lands on the right answer by
   * cancellation, so a case where they agree passes on the broken code and pins nothing. Here
   * the due date shifts (it is a UTC anchor) while "now" does not, which is the real failure.
   */

  it("calls a bill due today 'Due today' from the account's day, not the browser's", () => {
    // 08:00Z on the 5th is 16:00 on the 5th at UTC+8 and 01:00 on the 5th in the browser.
    // Browser-local truncation drags the due date back to the 4th and reports it overdue.
    expect(describeDueDate(due, -480, new Date("2026-09-05T08:00:00.000Z"))).toEqual({
      text: "Due today",
      isOverdue: false,
    });
  });

  it("holds at the other end of the day, where UTC has already moved on", () => {
    // 23:00Z on the 5th is 16:00 on the 5th for a UTC-7 account: still due today, not overdue.
    expect(describeDueDate(due, 420, new Date("2026-09-05T23:00:00.000Z")).text).toBe("Due today");
  });

  it("counts whole days overdue", () => {
    expect(describeDueDate(due, -480, new Date("2026-09-06T08:00:00.000Z"))).toEqual({
      text: "1 day overdue",
      isOverdue: true,
    });
    expect(describeDueDate(due, -480, new Date("2026-09-08T08:00:00.000Z")).text).toBe(
      "3 days overdue",
    );
  });

  it("names tomorrow and then falls through to the date", () => {
    expect(describeDueDate(due, -480, new Date("2026-09-04T08:00:00.000Z")).text).toBe(
      "Due tomorrow",
    );
    expect(describeDueDate(due, -480, new Date("2026-09-01T08:00:00.000Z")).text).toBe(
      "Due Sep 5, 2026",
    );
  });

  it("accepts the ISO string the API actually sends", () => {
    expect(
      describeDueDate("2026-09-05T00:00:00.000Z", -480, new Date("2026-09-05T08:00:00.000Z")).text,
    ).toBe("Due today");
  });
});
