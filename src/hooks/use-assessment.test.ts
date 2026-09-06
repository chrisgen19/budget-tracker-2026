import { describe, it, expect } from "vitest";
import { assessmentKeys } from "./use-assessment";
import { analyticsKeys } from "./use-analytics";

const period = { granularity: "monthly", from: "2026-09-01", to: "2026-09-30" };

describe("assessmentKeys", () => {
  /**
   * The facts key rides on the analytics namespace so that every financial
   * mutation — all of which already invalidate `analyticsKeys.all` — refreshes it
   * for free. Move it out and nothing fails loudly: the tab simply keeps showing
   * a bill as missed for five minutes after it was paid.
   */
  it("nests the facts key under the analytics namespace so invalidation reaches it", () => {
    const key = assessmentKeys.facts("someone@example.com", period);
    expect(key.slice(0, analyticsKeys.all.length)).toEqual([...analyticsKeys.all]);
  });

  it("keeps the cached report out of that namespace — it changes only on Generate", () => {
    const key = assessmentKeys.report("someone@example.com", period);
    expect(key.slice(0, analyticsKeys.all.length)).not.toEqual([...analyticsKeys.all]);
  });

  it("scopes both by user, so a shared client cannot leak one account's report into another", () => {
    expect(assessmentKeys.facts("a@example.com", period)).not.toEqual(assessmentKeys.facts("b@example.com", period));
    expect(assessmentKeys.report("a@example.com", period)).not.toEqual(assessmentKeys.report("b@example.com", period));
  });
});
