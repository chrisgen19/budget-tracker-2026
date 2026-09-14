import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyticsReturnTarget,
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

describe("analyticsReturnTarget", () => {
  it("builds an analytics href from a return blob", () => {
    expect(
      analyticsReturnTarget("period=custom&from=2026-07-01&to=2026-09-30&type=ALL&tab=reports", MANILA)?.href,
    ).toBe("/analytics?period=custom&from=2026-07-01&to=2026-09-30&type=ALL&tab=reports");
  });

  it("returns to the whole span a day drill-down came from, not the day", () => {
    // The one property the label used to demonstrate, asserted on the href itself:
    // the link goes to the analytics span, which is deliberately not the single day
    // the ledger is filtered to.
    const target = analyticsReturnTarget(
      "period=custom&from=2026-07-01&to=2026-09-30&type=EXPENSE&tab=reports",
      MANILA,
    );
    expect(target?.href).toContain("from=2026-07-01");
    expect(target?.href).toContain("to=2026-09-30");
  });

  it("carries nothing but the href, so nothing can name a period the link misses", () => {
    const target = analyticsReturnTarget(
      "period=monthly&from=2026-09-01&to=2026-09-30&type=EXPENSE&tab=reports",
      MANILA,
    );
    expect(Object.keys(target!)).toEqual(["href"]);
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
      const target = analyticsReturnTarget(blob, MANILA);
      expect(target).not.toBeNull();
      expect(target!.href.startsWith("/analytics?")).toBe(true);
      expect(target!.href).not.toContain("evil.example.com");
      expect(target!.href).not.toContain("javascript:");
    }
  });

  it("offers no way back when there is nothing to go back to", () => {
    expect(analyticsReturnTarget(null, MANILA)).toBeNull();
    expect(analyticsReturnTarget("", MANILA)).toBeNull();
    // Far longer than the five short params a real blob holds.
    expect(analyticsReturnTarget("x".repeat(201), MANILA)).toBeNull();
  });
});

describe("the mirror cannot mistake its own write for a navigation", () => {
  // The analytics page writes the URL from its state and reads its state from the
  // URL. Those two effects only terminate because a parse of what the writer
  // produced yields the same view, so the writer's own output never looks like an
  // external change. If this property broke, the page would loop.
  it("is a fixed point for every view the page can hold", () => {
    atSeptember();
    const views = [
      { period: { periodType: "monthly" as const, from: "2026-09-01", to: "2026-09-30" }, type: "EXPENSE" as const, tab: "reports" as const },
      { period: { periodType: "custom" as const, from: "2026-07-01", to: "2026-09-30" }, type: "ALL" as const, tab: "statistics" as const },
      { period: { periodType: "weekly" as const, from: "2026-08-31", to: "2026-09-06" }, type: "INCOME" as const, tab: "health" as const },
      { period: { periodType: "yearly" as const, from: "2026-01-01", to: "2026-12-31" }, type: "EXPENSE" as const, tab: "ai-assessment" as const },
    ];

    for (const view of views) {
      const written = analyticsSearchParams(view);
      const read = parseAnalyticsParams(new URLSearchParams(written), MANILA);
      expect(read, written).toEqual(view);
      // And writing what was read reproduces the same string, byte for byte — the
      // comparison the page actually makes is on the string, not the object.
      expect(analyticsSearchParams(read)).toBe(written);
    }
  });

  it("settles in one step even from a URL it would not have written", () => {
    // A bare URL, or one the nav item produced, parses to the default view; writing
    // that view gives a string which then parses back to itself.
    atSeptember();
    const fromBare = parseAnalyticsParams(new URLSearchParams(""), MANILA);
    const written = analyticsSearchParams(fromBare);
    expect(analyticsSearchParams(parseAnalyticsParams(new URLSearchParams(written), MANILA))).toBe(
      written,
    );
  });
});
