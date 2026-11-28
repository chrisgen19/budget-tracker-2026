// @vitest-environment node
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { findUnreachableOccurrences, resolveCursor, type HealBill, type HealLog } from "./heal-bill-dates";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const paid = (...isos: string[]): HealLog[] => isos.map((iso) => ({ dueDate: day(iso), status: "PAID" }));

/** PLDT as stored in production: monthly on the 20th, every month settled except April. */
const pldt: HealBill = {
  frequency: "MONTHLY",
  customIntervalDays: null,
  startDate: day("2026-03-20"),
  nextDueDate: day("2026-12-20"),
};
const pldtLogs = paid(
  "2026-03-20", "2026-05-20", "2026-06-20", "2026-07-20",
  "2026-08-20", "2026-09-20", "2026-10-20", "2026-11-20",
);

// Node re-reads TZ at runtime, so each block runs the same assertions in a different process
// zone. The bug only exists away from UTC: east of it truncation moved dates to the previous
// day's 16:00 UTC, west of it `getDate()` read the start day one early.
describe.each(["Asia/Manila", "America/Los_Angeles", "UTC"])("in %s", (tz) => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    process.env.TZ = original;
  });

  it("reports no drift for a cursor already on the first unpaid occurrence", () => {
    const { drifted, current, resolved } = resolveCursor(pldt, pldtLogs);
    expect(drifted).toBe(false);
    expect(current.toISOString()).toBe("2026-12-20T00:00:00.000Z");
    expect(resolved?.toISOString()).toBe("2026-12-20T00:00:00.000Z");
  });

  it("walks a cursor past a settled occurrence", () => {
    const { drifted, resolved } = resolveCursor(pldt, [...pldtLogs, ...paid("2026-12-20")]);
    expect(drifted).toBe(true);
    expect(resolved?.toISOString()).toBe("2027-01-20T00:00:00.000Z");
  });

  // The start day is the anchor for every later month: read a day early, a bill on the 31st
  // would move to the 30th once a short month had clamped it.
  it("keeps the start day as the month anchor", () => {
    const bill: HealBill = {
      frequency: "MONTHLY",
      customIntervalDays: null,
      startDate: day("2026-01-31"),
      nextDueDate: day("2026-02-28"),
    };
    const { resolved } = resolveCursor(bill, paid("2026-02-28"));
    expect(resolved?.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("returns null once the walk passes endDate", () => {
    const { resolved, drifted } = resolveCursor(
      { ...pldt, endDate: day("2026-12-31") },
      [...pldtLogs, ...paid("2026-12-20")],
    );
    expect(resolved).toBeNull();
    expect(drifted).toBe(false);
  });

  it("lists only occurrences with no log, on the bill's own day", () => {
    const { missing, truncated } = findUnreachableOccurrences(pldt, pldtLogs, 20_000);
    expect(missing).toEqual(["2026-04-20"]);
    expect(truncated).toBe(false);
  });

  it("stops and reports a CUSTOM bill whose interval never advances", () => {
    const bill: HealBill = { ...pldt, frequency: "CUSTOM", customIntervalDays: 0 };
    const { truncated } = findUnreachableOccurrences(bill, [], 20_000);
    expect(truncated).toBe(true);
  });
});
