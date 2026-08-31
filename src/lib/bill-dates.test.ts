import { afterAll, describe, expect, it } from "vitest";
import { utcDayKey, utcDayStart, userToday } from "@/lib/bill-dates";

// Node re-reads process.env.TZ at runtime, which is the only way to prove a helper ignores the
// process zone. Forcing it matters: this repo is developed in Asia/Manila, east of UTC, where a
// browser-local reading of a UTC-midnight anchor happens to land on the right day anyway.
const ORIGINAL_TZ = process.env.TZ;
// Read before anything touches TZ, so a broken restore cannot launder this into agreeing with
// itself. On a UTC machine it is 0 and the check below rests on ORIGINAL_TZ instead.
const MACHINE_HOUR = new Date("2026-01-01T00:00:00.000Z").getHours();

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

const inTimeZone = <T>(timeZone: string, fn: () => T): T => {
  process.env.TZ = timeZone;
  try {
    return fn();
  } finally {
    restoreTimeZone();
  }
};

// West of UTC, east of UTC, and UTC itself. Only the first can expose the shift.
const ZONES = ["America/Los_Angeles", "Asia/Manila", "UTC"];

describe("the timezone harness itself", () => {
  it("hands the ambient zone back, rather than the string \"undefined\"", () => {
    inTimeZone("America/Los_Angeles", () => utcDayKey("2026-09-05T00:00:00.000Z"));

    // `process.env.TZ = undefined` stores "undefined", which is not a zone: Node drops to UTC
    // and every later test in the worker silently reads a different clock.
    expect(process.env.TZ).toBe(ORIGINAL_TZ);
    expect(new Date("2026-01-01T00:00:00.000Z").getHours()).toBe(MACHINE_HOUR);
  });
});

describe("utcDayKey", () => {
  it("is exercised against a browser zone that really does shift the day", () => {
    // Guards the guard. If process.env.TZ ever stopped taking effect, every assertion below
    // would pass on a broken implementation and prove nothing.
    const localDay = inTimeZone("America/Los_Angeles", () =>
      new Date("2026-09-05T00:00:00.000Z").getDate(),
    );
    expect(localDay).toBe(4);
  });

  it("reports the stored calendar day in every browser timezone", () => {
    for (const zone of ZONES) {
      expect(inTimeZone(zone, () => utcDayKey("2026-09-05T00:00:00.000Z"))).toBe("2026-09-05");
    }
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(
      inTimeZone("America/Los_Angeles", () => utcDayKey(new Date("2026-09-05T00:00:00.000Z"))),
    ).toBe("2026-09-05");
  });

  it("zero-pads single-digit months and days", () => {
    expect(utcDayKey("2026-01-02T00:00:00.000Z")).toBe("2026-01-02");
  });

  it("round-trips utcDayStart, which is what the write path stores", () => {
    const stored = utcDayStart(new Date("2026-09-05T13:45:00.000Z"));
    expect(inTimeZone("America/Los_Angeles", () => utcDayKey(stored))).toBe("2026-09-05");
  });

  it("names the account's day, not UTC's, when handed userToday", () => {
    // 17:00Z on 31 August is already 01:00 on 1 September at UTC+8.
    const today = userToday(-480, new Date("2026-08-31T17:00:00.000Z"));
    expect(inTimeZone("America/Los_Angeles", () => utcDayKey(today))).toBe("2026-09-01");
  });
});
