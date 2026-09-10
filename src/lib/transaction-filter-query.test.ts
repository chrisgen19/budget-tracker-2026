import { describe, expect, it } from "vitest";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";
import {
  buildTransactionWhere,
  parseTransactionSearchParams,
  transactionFilterSchema,
} from "@/lib/transaction-filter-query";

/** UTC+8, the app's own timezone, in `getTimezoneOffset` convention. */
const MANILA = -480;

const whereDate = (overrides: Record<string, unknown>) => {
  const filters = transactionFilterSchema.parse(overrides);
  return buildTransactionWhere("user-1", filters).date;
};

describe("transactionFilterSchema", () => {
  it("accepts the shared search ceiling and rejects one character beyond it", () => {
    expect(
      transactionFilterSchema.safeParse({ search: "x".repeat(MAX_TRANSACTION_SEARCH_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      transactionFilterSchema.safeParse({ search: "x".repeat(MAX_TRANSACTION_SEARCH_LENGTH + 1) })
        .success,
    ).toBe(false);
  });
});

describe("date range filtering", () => {
  it("rejects a day that is not YYYY-MM-DD", () => {
    expect(transactionFilterSchema.safeParse({ dateFrom: "2026-9-1" }).success).toBe(false);
    expect(transactionFilterSchema.safeParse({ dateFrom: "2026-13-01" }).success).toBe(false);
    expect(transactionFilterSchema.safeParse({ dateFrom: "2026-09-01" }).success).toBe(true);
  });

  it("ends at the start of the day after dateTo, so the last day is included", () => {
    // A transaction at 23:59 on the 3rd must be inside a Jan 1–3 range.
    expect(whereDate({ dateFrom: "2026-01-01", dateTo: "2026-01-03" })).toEqual({
      gte: new Date("2026-01-01T00:00:00.000Z"),
      lt: new Date("2026-01-04T00:00:00.000Z"),
    });
  });

  it("turns a single day into that one whole local day", () => {
    // Manila midnight is 16:00 UTC the previous day.
    expect(whereDate({ dateFrom: "2026-09-12", dateTo: "2026-09-12", timezoneOffset: MANILA })).toEqual({
      gte: new Date("2026-09-11T16:00:00.000Z"),
      lt: new Date("2026-09-12T16:00:00.000Z"),
    });
  });

  it("replaces the month window rather than intersecting it", () => {
    // A range straddling two months must not be narrowed back to one of them.
    expect(whereDate({ month: "2026-02", dateFrom: "2026-01-15", dateTo: "2026-03-03" })).toEqual({
      gte: new Date("2026-01-15T00:00:00.000Z"),
      lt: new Date("2026-03-04T00:00:00.000Z"),
    });
  });

  it("still uses the month window when no range is set", () => {
    expect(whereDate({ month: "2026-02" })).toEqual({
      gte: new Date("2026-02-01T00:00:00.000Z"),
      lt: new Date("2026-03-01T00:00:00.000Z"),
    });
  });

  it("accepts an open-ended range at either end", () => {
    expect(whereDate({ dateFrom: "2026-01-01" })).toEqual({
      gte: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(whereDate({ dateTo: "2026-01-31" })).toEqual({
      lt: new Date("2026-02-01T00:00:00.000Z"),
    });
  });

  it("crosses a month and a year boundary on the exclusive end", () => {
    expect(whereDate({ dateFrom: "2026-12-31", dateTo: "2026-12-31" })).toEqual({
      gte: new Date("2026-12-31T00:00:00.000Z"),
      lt: new Date("2027-01-01T00:00:00.000Z"),
    });
  });

  it("leaves the date predicate off entirely when nothing narrows it", () => {
    expect(whereDate({})).toBeUndefined();
  });

  it("reads both ends off the query string", () => {
    const params = new URLSearchParams({ dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    expect(parseTransactionSearchParams(params)).toMatchObject({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
    expect(parseTransactionSearchParams(new URLSearchParams())).toMatchObject({
      dateFrom: null,
      dateTo: null,
    });
  });
});
