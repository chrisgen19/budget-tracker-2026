import { describe, expect, it } from "vitest";
import { capFindingsPerKind, WATCHLIST_FINDINGS_PER_KIND } from "./assessment-facts";
import { watchlistFindingKey } from "./watchlist-findings";
import type { AssessmentAnomaly } from "@/types";

/**
 * The order of suppression and capping, which is the whole of what #362 was about.
 *
 * Every detector used to cap itself on the way out, so the cap was spent *before* saved Watchlist
 * state was consulted: `/api/assessment/facts` computes keys only for the findings that were
 * emitted, and a resolved one still occupied a slot. Resolving the three on screen produced an
 * empty group rather than revealing the fourth, and a `RESOLVED` row never expires, so the fourth
 * was hidden for good.
 *
 * These assert the rule directly rather than through the route, which needs Prisma and a session.
 * `facts/route.test.ts` covers the wiring; what is worth pinning here is that the two operations
 * are not interchangeable, because reading the code cannot tell you that and reversing them
 * type-checks, passes every other test, and silently reinstates the bug.
 */
const finding = (kind: string, title: string): AssessmentAnomaly =>
  ({
    kind,
    scope: "outstanding",
    severity: "medium",
    title,
    detail: `${title} detail`,
    current: null,
    baseline: null,
    changePct: null,
    stateKey: `k:${title}`,
  }) as unknown as AssessmentAnomaly;

const PERIOD = { from: "2026-09-01", to: "2026-09-30" };

describe("capFindingsPerKind", () => {
  it("keeps the first n of each kind and counts kinds independently", () => {
    const findings = [
      finding("bill-under-budgeted", "a"),
      finding("bill-under-budgeted", "b"),
      finding("recurring-ended", "c"),
      finding("bill-under-budgeted", "d"),
      finding("recurring-ended", "e"),
    ];
    // `d` is the third `bill-under-budgeted` and goes; `e` is only the second `recurring-ended`
    // and stays, which is the "counts kinds independently" half.
    expect(capFindingsPerKind(findings, 2).map((f) => f.title)).toEqual(["a", "b", "c", "e"]);
    expect(capFindingsPerKind(findings, 1).map((f) => f.title)).toEqual(["a", "c"]);
  });

  it("leaves a list already under the cap alone", () => {
    const findings = [finding("recurring-ended", "a"), finding("recurring-ended", "b")];
    expect(capFindingsPerKind(findings, 5)).toHaveLength(2);
  });
});

describe("suppression before the cap", () => {
  /** Four of one kind, the three the user can see already resolved. */
  const four = ["a", "b", "c", "d"].map((t) => finding("bill-under-budgeted", t));
  const resolvedFirstThree = Object.fromEntries(
    four.slice(0, 3).map((f) => [watchlistFindingKey(f, PERIOD), "RESOLVED" as const]),
  );

  const drop = (findings: AssessmentAnomaly[]) =>
    findings.filter((f) => resolvedFirstThree[watchlistFindingKey(f, PERIOD)] === undefined);

  it("reveals the fourth once the three on screen are resolved", () => {
    const shown = capFindingsPerKind(drop(four), WATCHLIST_FINDINGS_PER_KIND);
    expect(shown.map((f) => f.title)).toEqual(["d"]);
  });

  /**
   * The bug, kept as a test so the two orderings are visibly not interchangeable: capping first
   * spends all three slots on findings already dealt with and shows an empty group.
   */
  it("shows nothing at all if the cap is applied first", () => {
    const shown = drop(capFindingsPerKind(four, WATCHLIST_FINDINGS_PER_KIND));
    expect(shown).toEqual([]);
  });
});
