import { describe, it, expect } from "vitest";
import {
  computeNextDueDate,
  advanceToNextUnpaidOccurrence,
  utcDayStart,
  addUtcDays,
} from "./bill-utils";

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
