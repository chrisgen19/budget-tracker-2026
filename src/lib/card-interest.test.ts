import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/lib/default-categories";
import {
  INTEREST_CATEGORY_NAME,
  describeCardInterest,
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
