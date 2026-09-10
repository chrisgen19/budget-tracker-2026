import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterSearchParams,
  parseFilterParams,
  parsePeriodParams,
  type PeriodParams,
} from "@/lib/transaction-period-url";

/** UTC+8. 20:00 UTC on Aug 31 is already September here. */
const MANILA = -480;

const parse = (query: string, tz = MANILA) =>
  parsePeriodParams(new URLSearchParams(query), tz);

/** What an unusable link must fall back to. */
const CURRENT_MONTH: PeriodParams = {
  period: "monthly",
  from: "2026-09-01",
  to: "2026-09-30",
};

afterEach(() => {
  vi.useRealTimers();
});

const atSeptember = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T04:00:00Z"));
};

describe("parsePeriodParams", () => {
  it("reads a bounded period", () => {
    expect(parse("period=weekly&from=2026-09-07&to=2026-09-13")).toEqual({
      period: "weekly",
      from: "2026-09-07",
      to: "2026-09-13",
    });
  });

  it("reads All time as unbounded", () => {
    expect(parse("period=all")).toEqual({ period: "all", from: null, to: null });
  });

  it("falls back to the account's current month, not UTC's", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T20:00:00Z"));
    expect(parse("")).toEqual(CURRENT_MONTH);
    expect(parse("", 480)).toEqual({
      period: "monthly",
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it.each([
    ["an unknown period", "period=quarterly&from=2026-09-01&to=2026-09-30"],
    ["a bounded period with no window", "period=monthly"],
    ["a window missing its end", "period=custom&from=2026-09-01"],
    ["a window missing its start", "period=custom&to=2026-09-30"],
    ["a window that runs backwards", "period=custom&from=2026-09-30&to=2026-09-01"],
    ["a date that is not on the calendar", "period=custom&from=2026-02-30&to=2026-03-05"],
    ["a date that is not a date", "period=custom&from=yesterday&to=today"],
    ["All time carrying a stale window", "period=all&from=2026-09-01&to=2026-09-30"],
  ])("discards %s whole", (_label, query) => {
    // Repairing one field at a time would show one window while the URL claimed
    // another, and a state the schema rejects 400s every request the page makes.
    atSeptember();
    expect(parse(query)).toEqual(CURRENT_MONTH);
  });
});

describe("filterSearchParams", () => {
  it("writes a bounded period", () => {
    expect(filterSearchParams({ period: "monthly", from: "2026-09-01", to: "2026-09-30" })).toBe(
      "period=monthly&from=2026-09-01&to=2026-09-30",
    );
  });

  it("writes All time with no bounds", () => {
    expect(filterSearchParams({ period: "all", from: null, to: null })).toBe("period=all");
  });

  it.each<PeriodParams>([
    { period: "monthly", from: "2026-09-01", to: "2026-09-30" },
    { period: "weekly", from: "2026-08-31", to: "2026-09-06" },
    { period: "yearly", from: "2026-01-01", to: "2026-12-31" },
    { period: "custom", from: "2026-03-04", to: "2026-07-19" },
    { period: "all", from: null, to: null },
  ])("round-trips $period", (period) => {
    atSeptember();
    expect(parse(filterSearchParams(period))).toEqual(period);
  });
});

describe("the narrowings the address bar carries", () => {
  const parseAll = (query: string) => parseFilterParams(new URLSearchParams(query), MANILA);

  it("keeps a drill-down's narrowings through a write and a read", () => {
    // The page mirrors its filters to the URL on every change. A mirror that
    // wrote back only the period would drop the category, and the reader — seeing
    // the URL change — would take it off the filters too, widening the list the
    // user had just narrowed by tapping a breakdown row.
    atSeptember();
    const arrived = parseAll("type=EXPENSE&categoryId=c1&period=custom&from=2026-09-01&to=2026-09-30");
    expect(arrived).toMatchObject({
      type: "EXPENSE",
      categoryId: "c1",
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(parseAll(filterSearchParams(arrived))).toEqual(arrived);
  });

  it("defaults each narrowing rather than trusting the link", () => {
    atSeptember();
    expect(parseAll("type=TRANSFER")).toMatchObject({ type: "ALL" });
    expect(parseAll("")).toMatchObject({
      type: "ALL",
      categoryId: null,
      labelId: null,
      search: "",
    });
  });

  it("drops an id longer than the API accepts", () => {
    // Holding it would leave every request failing with a 400 and no way out but
    // editing the address bar.
    atSeptember();
    expect(parseAll(`categoryId=${"c".repeat(101)}`).categoryId).toBeNull();
    expect(parseAll(`labelId=${"l".repeat(101)}`).labelId).toBeNull();
    expect(parseAll(`categoryId=${"c".repeat(100)}`).categoryId).toBe("c".repeat(100));
  });

  it("truncates an oversized search rather than failing the API's ceiling", () => {
    atSeptember();
    expect(parseAll(`search=${"x".repeat(500)}`).search.length).toBe(255);
  });

  it("omits defaults rather than spelling them out", () => {
    expect(
      filterSearchParams({ period: "all", from: null, to: null, type: "ALL", categoryId: null, search: "" }),
    ).toBe("period=all");
  });
});
