import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyticsReturnHref,
  analyticsSearchParams,
  parseAnalyticsParams,
} from "@/lib/analytics-url";

/** UTC+8. 20:00 UTC on Aug 31 is already September here. */
const MANILA = -480;

const parse = (query: string) => parseAnalyticsParams(new URLSearchParams(query), MANILA);

afterEach(() => vi.useRealTimers());

const atSeptember = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T04:00:00Z"));
};

describe("parseAnalyticsParams", () => {
  it("reads the view a return link describes", () => {
    expect(parse("period=custom&from=2026-07-01&to=2026-09-30&type=INCOME&tab=statistics")).toEqual({
      period: { periodType: "custom", from: "2026-07-01", to: "2026-09-30" },
      type: "INCOME",
      tab: "statistics",
    });
  });

  it("lands where a fresh visit lands when the URL says nothing", () => {
    // EXPENSE, not ALL: the Breakdowns card opens on Expenses, and a bare URL
    // should not put the user somewhere a fresh visit would not.
    atSeptember();
    expect(parse("")).toEqual({
      period: { periodType: "monthly", from: "2026-09-01", to: "2026-09-30" },
      type: "EXPENSE",
      tab: "reports",
    });
  });

  it("refuses All time, which no analytics chart can render", () => {
    // /api/analytics requires a bounded window and the picker is mounted with
    // allowAllTime false, so honouring this would mean an unsatisfiable request.
    atSeptember();
    expect(parse("period=all").period).toEqual({
      periodType: "monthly",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("falls back for a window it cannot trust", () => {
    atSeptember();
    const currentMonth = { periodType: "monthly", from: "2026-09-01", to: "2026-09-30" };
    for (const query of [
      "period=custom&from=2026-07-01", // half a window
      "period=custom&from=2026-09-30&to=2026-09-02", // backwards
      "period=custom&from=2026-02-31&to=2026-03-05", // not a real day
      "period=nonsense&from=2026-07-01&to=2026-09-30",
    ]) {
      expect(parse(query).period, query).toEqual(currentMonth);
    }
  });

  it("ignores a type or tab it does not recognise", () => {
    atSeptember();
    expect(parse("type=TRANSFER&tab=evil")).toMatchObject({ type: "EXPENSE", tab: "reports" });
  });
});

describe("analyticsSearchParams", () => {
  it("round-trips every view", () => {
    atSeptember();
    for (const state of [
      { period: { periodType: "monthly" as const, from: "2026-09-01", to: "2026-09-30" }, type: "EXPENSE" as const, tab: "reports" as const },
      { period: { periodType: "custom" as const, from: "2026-07-01", to: "2026-09-30" }, type: "ALL" as const, tab: "health" as const },
      { period: { periodType: "yearly" as const, from: "2026-01-01", to: "2026-12-31" }, type: "INCOME" as const, tab: "ai-assessment" as const },
    ]) {
      expect(parse(analyticsSearchParams(state))).toEqual(state);
    }
  });

  it("writes the defaults rather than omitting them", () => {
    // This string is also what a return link carries, where an absent value cannot
    // be told apart from a link written before the param existed.
    expect(analyticsSearchParams({
      period: { periodType: "monthly", from: "2026-09-01", to: "2026-09-30" },
      type: "EXPENSE",
      tab: "reports",
    })).toBe("period=monthly&from=2026-09-01&to=2026-09-30&type=EXPENSE&tab=reports");
  });
});

describe("analyticsReturnHref", () => {
  it("builds an analytics href from a return blob", () => {
    expect(analyticsReturnHref("period=custom&from=2026-07-01&to=2026-09-30&type=ALL&tab=reports", MANILA))
      .toBe("/analytics?period=custom&from=2026-07-01&to=2026-09-30&type=ALL&tab=reports");
  });

  it("has no way to send the visitor off-site", () => {
    // The path is a literal and every param is re-serialized, so a crafted blob can
    // only ever name a different analytics view.
    atSeptember();
    for (const blob of [
      "https://evil.example.com",
      "period=custom&from=2026-07-01&to=2026-09-30&next=https://evil.example.com",
      "//evil.example.com",
      "javascript:alert(1)",
    ]) {
      const href = analyticsReturnHref(blob, MANILA);
      expect(href).not.toBeNull();
      expect(href!.startsWith("/analytics?")).toBe(true);
      expect(href).not.toContain("evil.example.com");
      expect(href).not.toContain("javascript:");
    }
  });

  it("offers no way back when there is nothing to go back to", () => {
    expect(analyticsReturnHref(null, MANILA)).toBeNull();
    expect(analyticsReturnHref("", MANILA)).toBeNull();
    // Far longer than the five short params a real blob holds.
    expect(analyticsReturnHref("x".repeat(201), MANILA)).toBeNull();
  });
});
