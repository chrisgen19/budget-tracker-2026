import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/lib/default-categories";
import {
  INTEREST_CATEGORY_NAME,
  describeCardInterest,
  overallUtilizationOf,
  utilizationOf,
} from "@/lib/card-interest";

describe("INTEREST_CATEGORY_NAME", () => {
  /**
   * The name is the whole identification rule. Seeding it under a different spelling than the one
   * the queries match on would report every card as never having been charged interest, silently.
   */
  it("names a category that is actually seeded, as an expense", () => {
    const seeded = DEFAULT_CATEGORIES.find((c) => c.name === INTEREST_CATEGORY_NAME);
    expect(seeded).toBeDefined();
    expect(seeded?.type).toBe("EXPENSE");
  });
});

describe("describeCardInterest", () => {
  it("reports a card that has never had interest logged as untracked, not as zero", () => {
    expect(describeCardInterest({ period: 0, everLogged: false })).toEqual({ state: "untracked" });
  });

  /**
   * A card mid-onboarding can have interest logged in an older month and none in the month on
   * screen. That is genuinely nothing charged, and it must not read as "we are not tracking this".
   */
  it("separates a real zero from an untracked one", () => {
    expect(describeCardInterest({ period: 0, everLogged: true })).toEqual({
      state: "none-this-period",
    });
  });

  it("reports what was charged in the month", () => {
    expect(describeCardInterest({ period: 1446.5, everLogged: true })).toEqual({
      state: "charged",
      amount: 1446.5,
    });
  });

  /**
   * A refund of a fee can leave the month negative. It is still a month with interest activity, so
   * it is not "none", and the figure is shown as it stands rather than clamped to zero.
   */
  it("keeps a negative month as a charge rather than calling it none", () => {
    expect(describeCardInterest({ period: -200, everLogged: true })).toEqual({
      state: "charged",
      amount: -200,
    });
  });
});

describe("utilizationOf", () => {
  it("reports the share of the limit in use", () => {
    expect(utilizationOf(18400, 48000)).toBe(38.3);
  });

  /** No limit recorded is not 0% used, it is a question the data cannot answer. */
  it("is null without a limit", () => {
    expect(utilizationOf(18400, null)).toBeNull();
  });

  /** A zero limit would divide to Infinity, which would render as a figure. */
  it("is null on a zero limit rather than infinite", () => {
    expect(utilizationOf(100, 0)).toBeNull();
  });

  /**
   * Not clamped. Over the limit is the most useful thing this number says, and clamping would
   * render it identically to sitting exactly on the limit.
   */
  it("goes above 100 when the card is over its limit", () => {
    expect(utilizationOf(52000, 48000)).toBeGreaterThan(100);
  });

  it("goes below zero when the card holds a credit", () => {
    expect(utilizationOf(-500, 48000)).toBeLessThan(0);
  });
});

describe("overallUtilizationOf", () => {
  it("is one sum over another, not the mean of each card's percentage", () => {
    // 10% of 100,000 and 90% of 1,000: averaging the percentages says 50% used, which is nonsense.
    const overall = overallUtilizationOf([
      { balance: 10_000, creditLimit: 100_000 },
      { balance: 900, creditLimit: 1_000 },
    ]);
    expect(overall?.percent).toBeCloseTo(10.8, 1);
    expect(overall?.counted).toBe(2);
  });

  /**
   * The failure this function exists to prevent. Summing every balance while summing only the
   * known limits inflates the ratio, and inflates it in the direction that provokes a payment
   * nobody needed to make.
   */
  it("drops a card with no limit from both sides, never from one", () => {
    const overall = overallUtilizationOf([
      { balance: 25_000, creditLimit: 100_000 },
      { balance: 50_000, creditLimit: null },
    ]);
    expect(overall?.percent).toBe(25);
    expect(overall?.counted).toBe(1);
    expect(overall?.omitted).toBe(1);
  });

  /** A paid-off card still offers its limit, so leaving it out would overstate the ratio. */
  it("counts a card that owes nothing, which is what keeps the figure honest", () => {
    const overall = overallUtilizationOf([
      { balance: 25_000, creditLimit: 50_000 },
      { balance: 0, creditLimit: 50_000 },
    ]);
    expect(overall?.percent).toBe(25);
    expect(overall?.counted).toBe(2);
  });

  /** No limit anywhere is a question the data cannot answer, and 0% is an answer. */
  it("is null when no card carries a limit", () => {
    expect(overallUtilizationOf([{ balance: 25_000, creditLimit: null }])).toBeNull();
    expect(overallUtilizationOf([])).toBeNull();
  });

  /** Same rule as utilizationOf: a zero limit would divide to Infinity. */
  it("ignores a zero limit rather than dividing by it", () => {
    const overall = overallUtilizationOf([
      { balance: 100, creditLimit: 0 },
      { balance: 25_000, creditLimit: 100_000 },
    ]);
    expect(overall?.percent).toBe(25);
    expect(overall?.omitted).toBe(1);
  });

  /** Not clamped, for the reason utilizationOf is not: over the limit is the useful reading. */
  it("goes above 100 when the portfolio is over its limits", () => {
    expect(overallUtilizationOf([{ balance: 52_000, creditLimit: 48_000 }])?.percent).toBeGreaterThan(100);
  });

  it("agrees with utilizationOf on a single card", () => {
    const one = { balance: 18_400, creditLimit: 48_000 };
    expect(overallUtilizationOf([one])?.percent).toBe(utilizationOf(one.balance, one.creditLimit));
  });
});
