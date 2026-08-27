import { describe, expect, it } from "vitest";
import { monthsSince, previousMonthOf } from "@/lib/telegram/month-window";

/** 2026-08-26 18:30 in Manila (UTC+8). */
const NOW = new Date("2026-08-26T10:30:00.000Z");
const MANILA = -480;

describe("monthsSince", () => {
  it("is zero for the current month", () => {
    expect(monthsSince("2026-08", MANILA, NOW)).toBe(0);
  });

  it("counts back within a year", () => {
    expect(monthsSince("2026-07", MANILA, NOW)).toBe(1);
    expect(monthsSince("2026-02", MANILA, NOW)).toBe(6);
    expect(monthsSince("2026-01", MANILA, NOW)).toBe(7);
  });

  // The bug this covers: a fixed six-month window returned recent rows for an older question,
  // so the code saw history, skipped its fallback, and reported that the older occurrence never
  // existed. The window has to reach the month actually asked about.
  it("counts back across a year boundary", () => {
    expect(monthsSince("2025-12", MANILA, NOW)).toBe(8);
    expect(monthsSince("2025-08", MANILA, NOW)).toBe(12);
    expect(monthsSince("2024-08", MANILA, NOW)).toBe(24);
  });

  it("is zero for a future month rather than negative", () => {
    // A negative window would be nonsense passed to the query rather than merely wrong.
    expect(monthsSince("2026-09", MANILA, NOW)).toBe(0);
    expect(monthsSince("2027-01", MANILA, NOW)).toBe(0);
  });

  it("uses the user's calendar, not the host's", () => {
    // 2026-08-31T17:00Z is already September in Manila, so August is one month back there and
    // zero months back in UTC.
    const lateAugustUtc = new Date("2026-08-31T17:00:00.000Z");
    expect(monthsSince("2026-08", MANILA, lateAugustUtc)).toBe(1);
    expect(monthsSince("2026-08", 0, lateAugustUtc)).toBe(0);
  });

  // The window is capped, so a month beyond it must be recognised as out of range rather than
  // answered from a window that never reached it.
  it("reports a distance past the history cap, so the caller can refuse", () => {
    expect(monthsSince("2019-08", MANILA, NOW)).toBe(84);
    expect(monthsSince("2021-01", MANILA, NOW)).toBe(67);
    // Just inside a 60-month window once the +2 buffer is added.
    expect(monthsSince("2021-11", MANILA, NOW)).toBe(57);
  });

  it("returns zero for anything it cannot parse", () => {
    for (const bad of ["August", "2026-8", "2026-13", "", "not-a-month"]) {
      expect(monthsSince(bad, MANILA, NOW), bad).toBe(0);
    }
  });
});

describe("previousMonthOf", () => {
  it("steps back one month", () => {
    expect(previousMonthOf("2026-08")).toBe("2026-07");
    expect(previousMonthOf("2026-10")).toBe("2026-09");
  });

  // Done on the string precisely so this case cannot go wrong: constructing a Date from a month
  // and stepping back is where off-by-one and timezone errors come from.
  it("crosses the year boundary", () => {
    expect(previousMonthOf("2026-01")).toBe("2025-12");
  });

  it("keeps the two-digit padding", () => {
    expect(previousMonthOf("2026-11")).toBe("2026-10");
    expect(previousMonthOf("2026-02")).toBe("2026-01");
  });

  it("passes through anything it cannot parse", () => {
    for (const bad of ["August", "2026-13", ""]) expect(previousMonthOf(bad)).toBe(bad);
  });
});
