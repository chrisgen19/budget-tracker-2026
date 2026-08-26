import { describe, expect, it } from "vitest";
import { localDay, localTimestamp } from "@/lib/telegram/local-time";
import { isRealDate, resolveTransactionDate } from "@/lib/validations";

/** 2026-08-26T10:30:00Z, which is 18:30 on the same day in Manila (UTC+8). */
const NOW = new Date("2026-08-26T10:30:00.000Z");
const MANILA = -480;

describe("localTimestamp", () => {
  it("renders the user's wall clock, not the UTC instant", () => {
    expect(localTimestamp(MANILA, NOW)).toBe("2026-08-26T18:30:00");
  });

  it("carries no zone suffix", () => {
    // The bug this covers: `toISOString()` appended `Z`, labelling 18:30 Manila as 18:30 UTC.
    // resolveTransactionDate honours an explicit zone, so a model that copied the supplied
    // timestamp stored the transaction eight hours in the future.
    expect(localTimestamp(MANILA, NOW)).not.toMatch(/[Zz]|[+-]\d{2}:\d{2}$/);
  });

  it("round-trips through the server's own resolver to the instant it started from", () => {
    const resolved = resolveTransactionDate(localTimestamp(MANILA, NOW), MANILA, NOW);
    expect(new Date(resolved).getTime()).toBe(NOW.getTime());
  });

  it("produces a value the transaction date schema accepts", () => {
    expect(isRealDate(localTimestamp(MANILA, NOW))).toBe(true);
    expect(isRealDate(localTimestamp(0, NOW))).toBe(true);
  });

  it("crosses the day boundary the way the user's calendar does", () => {
    // 2026-08-25T17:00Z is already the 26th in Manila. A UTC timestamp would say the 25th.
    expect(localTimestamp(MANILA, new Date("2026-08-25T17:00:00.000Z"))).toBe("2026-08-26T01:00:00");
  });
});

describe("localDay", () => {
  // The bug this covers: search_transactions returns `date` as a full UTC instant, while
  // create_transactions returns a day already resolved for the user. Slicing the first ten
  // characters off the former printed the UTC day, so a 01:00 transaction on 1 September in
  // Manila was listed under 31 August.
  it("gives the user's calendar day, not the UTC one", () => {
    expect(localDay("2026-08-31T17:00:00.000Z", MANILA)).toBe("2026-09-01");
  });

  it("agrees with UTC for a user in UTC", () => {
    expect(localDay("2026-08-31T17:00:00.000Z", 0)).toBe("2026-08-31");
  });

  it("handles an instant that stays on the same day", () => {
    expect(localDay("2026-08-26T10:30:00.000Z", MANILA)).toBe("2026-08-26");
  });

  it("goes back a day for a user west of Greenwich", () => {
    // New York, UTC-4: 01:00Z on the 26th is still the evening of the 25th there.
    expect(localDay("2026-08-26T01:00:00.000Z", 240)).toBe("2026-08-25");
  });

  it("passes an unparseable value through rather than rendering Invalid Date", () => {
    expect(localDay("nonsense-value-here", MANILA)).toBe("nonsense-v");
  });
});
