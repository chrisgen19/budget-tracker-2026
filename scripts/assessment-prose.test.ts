// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CURRENCY_IN_PROSE, previousPeriod } from "./assessment-prose";

describe("CURRENCY_IN_PROSE", () => {
  /**
   * The form the leak actually takes. The model is handed bare numbers in the
   * snapshot and told the currency separately, so requiring a symbol before the
   * digits let the two likeliest leaks through clean -- and that check was the
   * headline promise of the report.
   */
  it.each([
    "electricity hit 14,126 in May",
    "about 1,500 PHP",
    "spending of 22000 on rent",
    "you paid 5300 pesos",
    "₱1,200 on dining",
    "PHP 500 saved",
    "roughly 8,564.50 last month",
    "$50.25 subscription",
  ])("catches a raw amount in %j", (prose) => {
    expect(CURRENCY_IN_PROSE.test(prose)).toBe(true);
  });

  /**
   * The other half, and the one that decides whether anyone keeps reading the
   * output: a check that fires on "up 200%" or on a year cries wolf every run,
   * and a reader who learns to ignore it has no check at all.
   */
  it.each([
    "dining is ~18% of spending, up 12% vs last period",
    "2026-07 was excluded due to incomplete coverage (52%)",
    "July 2026 coverage was 52%",
    "6 days of 30 logged",
    "about 7x the typical charge",
    "your savings rate is 28%",
    "up 200% against baseline",
    "1,234% growth",
    "in 1995 and 2026",
  ])("leaves legitimate prose alone: %j", (prose) => {
    expect(CURRENCY_IN_PROSE.test(prose)).toBe(false);
  });
});

describe("previousPeriod", () => {
  it("shifts a full calendar month back one month", () => {
    expect(previousPeriod("2026-08-01", "2026-08-31")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
      label: "2026-07",
    });
  });

  it("crosses the January boundary into the previous year", () => {
    expect(previousPeriod("2026-01-01", "2026-01-31")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("lands on February's real length rather than assuming 30", () => {
    expect(previousPeriod("2026-03-01", "2026-03-31").to).toBe("2026-02-28");
  });

  it("shifts a partial range back by its own length", () => {
    // A seven-day window ending the day before it starts.
    expect(previousPeriod("2026-08-08", "2026-08-14")).toMatchObject({ from: "2026-08-01", to: "2026-08-07" });
  });

  /**
   * The bug this pins. The comparison window used to come from the clock, so the
   * script's own documented invocation compared August against itself and handed
   * the model a `previousSummary` identical to `summary`.
   */
  it("never returns the window it was given", () => {
    for (const [from, to] of [["2026-08-01", "2026-08-31"], ["2026-08-08", "2026-08-14"], ["2026-01-01", "2026-12-31"]]) {
      const prev = previousPeriod(from, to);
      expect(prev.to < from).toBe(true);
    }
  });
});
