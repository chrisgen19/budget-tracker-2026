import { describe, expect, it } from "vitest";
import { localTimestamp } from "@/lib/telegram/local-time";
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

