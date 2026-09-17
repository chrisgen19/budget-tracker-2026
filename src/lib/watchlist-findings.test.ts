import { describe, expect, it } from "vitest";
import { watchlistFindingKey } from "@/lib/watchlist-findings";
import type { AssessmentAnomaly } from "@/types";

const finding = (over: Partial<AssessmentAnomaly> = {}): AssessmentAnomaly => ({
  kind: "duplicate",
  scope: "period",
  severity: "medium",
  title: "Possible duplicate",
  detail: "Same day, same description and amount.",
  current: null,
  baseline: null,
  changePct: null,
  ...over,
});

describe("watchlistFindingKey", () => {
  it("keeps a period finding scoped to the report it was measured in", () => {
    expect(watchlistFindingKey(finding(), { from: "2026-09-01", to: "2026-09-30" })).not.toBe(
      watchlistFindingKey(finding(), { from: "2026-10-01", to: "2026-10-31" }),
    );
  });

  it("keeps an outstanding finding stable while another period is opened", () => {
    const outstanding = finding({ kind: "missed-bill", scope: "outstanding" });
    expect(watchlistFindingKey(outstanding, { from: "2026-09-01", to: "2026-09-30" })).toBe(
      watchlistFindingKey(outstanding, { from: "2026-10-01", to: "2026-10-31" }),
    );
  });

  it("changes when the evidence changes, so a fresh finding is not hidden", () => {
    const period = { from: "2026-09-01", to: "2026-09-30" };
    expect(watchlistFindingKey(finding(), period)).not.toBe(
      watchlistFindingKey(finding({ detail: "A different duplicate is now present." }), period),
    );
  });
});
