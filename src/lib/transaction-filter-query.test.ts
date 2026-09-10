import { describe, expect, it } from "vitest";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";
import {
  buildTransactionWhere,
  transactionFilterSchema,
} from "@/lib/transaction-filter-query";

/** `Date#getTimezoneOffset` convention: UTC+8 is -480, UTC-8 is 480. */
const MANILA = -480;
const LOS_ANGELES = 480;

const parse = (filters: Record<string, unknown>) => transactionFilterSchema.safeParse(filters);

const where = (filters: Record<string, unknown>) =>
  buildTransactionWhere("user-1", transactionFilterSchema.parse(filters));

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

  it("accepts a fully described range", () => {
    expect(parse({ period: "custom", from: "2026-09-01", to: "2026-09-30" }).success).toBe(true);
  });

  it("accepts a single-day range", () => {
    expect(parse({ period: "custom", from: "2026-09-10", to: "2026-09-10" }).success).toBe(true);
  });

  it("refuses a half-specified range from either end", () => {
    // The bulk endpoints materialize their targets from these filters, so a bound
    // lost in transit must fail rather than silently widen the operation.
    expect(parse({ period: "custom", from: "2026-09-01", to: null }).success).toBe(false);
    expect(parse({ period: "custom", from: null, to: "2026-09-30" }).success).toBe(false);
  });

  it("refuses a range that runs backwards", () => {
    expect(parse({ period: "custom", from: "2026-09-30", to: "2026-09-01" }).success).toBe(false);
  });

  it("refuses a bounded period that arrives with no window", () => {
    expect(parse({ period: "monthly", from: null, to: null }).success).toBe(false);
    expect(parse({ period: "weekly", from: null, to: null }).success).toBe(false);
  });

  it("refuses a date that is not on the calendar", () => {
    expect(parse({ period: "custom", from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
  });

  it("accepts All time with no window", () => {
    expect(parse({ period: "all" }).success).toBe(true);
  });

  it("accepts a legacy month-only caller that sends no period at all", () => {
    const result = parse({ month: "2026-08" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.period).toBeNull();
  });
});

describe("buildTransactionWhere date window", () => {
  it("resolves a range against the account timezone, not UTC", () => {
    // Sep 1–30 in Manila starts at 16:00 UTC on Aug 31 and ends before 16:00 UTC on Sep 30.
    expect(
      where({ period: "monthly", from: "2026-09-01", to: "2026-09-30", timezoneOffset: MANILA })
        .date,
    ).toEqual({
      gte: new Date("2026-08-31T16:00:00.000Z"),
      lt: new Date("2026-09-30T16:00:00.000Z"),
    });

    expect(
      where({
        period: "monthly",
        from: "2026-09-01",
        to: "2026-09-30",
        timezoneOffset: LOS_ANGELES,
      }).date,
    ).toEqual({
      gte: new Date("2026-09-01T08:00:00.000Z"),
      lt: new Date("2026-10-01T08:00:00.000Z"),
    });
  });

  it("includes the whole of the final day", () => {
    // An inclusive `to` of Sep 10 must not stop at Sep 10 00:00.
    const single = where({
      period: "custom",
      from: "2026-09-10",
      to: "2026-09-10",
      timezoneOffset: MANILA,
    }).date;
    expect(single).toEqual({
      gte: new Date("2026-09-09T16:00:00.000Z"),
      lt: new Date("2026-09-10T16:00:00.000Z"),
    });
  });

  it("rolls the upper bound over a year boundary", () => {
    expect(
      where({ period: "yearly", from: "2026-01-01", to: "2026-12-31", timezoneOffset: MANILA })
        .date,
    ).toEqual({
      gte: new Date("2025-12-31T16:00:00.000Z"),
      lt: new Date("2026-12-31T16:00:00.000Z"),
    });
  });

  it("still honors a legacy month when no range is given", () => {
    expect(where({ month: "2026-08", timezoneOffset: MANILA }).date).toEqual({
      gte: new Date("2026-07-31T16:00:00.000Z"),
      lt: new Date("2026-08-31T16:00:00.000Z"),
    });
  });

  it("gives an explicit range precedence over a month left in the payload", () => {
    expect(
      where({
        period: "weekly",
        from: "2026-09-07",
        to: "2026-09-13",
        month: "2026-08",
        timezoneOffset: MANILA,
      }).date,
    ).toEqual({
      gte: new Date("2026-09-06T16:00:00.000Z"),
      lt: new Date("2026-09-13T16:00:00.000Z"),
    });
  });

  it("lets All time clear a stale month rather than quietly filtering by it", () => {
    expect(where({ period: "all", month: "2026-08", timezoneOffset: MANILA }).date).toBeUndefined();
  });

  it("applies no date clause when nothing narrows the window", () => {
    expect(where({ timezoneOffset: MANILA }).date).toBeUndefined();
  });

  it("leaves the other filters untouched", () => {
    expect(
      where({
        period: "custom",
        from: "2026-09-01",
        to: "2026-09-30",
        type: "EXPENSE",
        search: "coffee",
        timezoneOffset: MANILA,
      }),
    ).toMatchObject({
      userId: "user-1",
      type: "EXPENSE",
      description: { contains: "coffee", mode: "insensitive" },
    });
  });
});
