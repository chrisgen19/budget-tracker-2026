import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PatternsCard } from "@/components/analytics/assessment/patterns-card";
import type { AssessmentAnomaly } from "@/types";

const fmt = (value: number | null) => (value === null ? "-" : `P${value}`);

const anomaly = (over: Partial<AssessmentAnomaly>): AssessmentAnomaly => ({
  kind: "duplicate",
  scope: "period",
  severity: "medium",
  title: "t",
  detail: "d",
  current: null,
  baseline: null,
  changePct: null,
  ...over,
});

const missedBill = anomaly({
  kind: "missed-bill",
  scope: "outstanding",
  severity: "high",
  title: "1 bill with no payment recorded",
  current: 900,
});

/**
 * The card is titled "What changed this period", and it used to list the missed bill with
 * everything else, dating a live overdue bill to whichever period was open (#340). The bill is
 * still shown on the same tab, by `MissedBillsCard`.
 */
describe("PatternsCard", () => {
  it("lists only the findings measured in the period", () => {
    render(
      <PatternsCard
        anomalies={[missedBill, anomaly({ title: "2 possible duplicate entries" })]}
        fmt={fmt}
      />,
    );

    expect(screen.getByText("2 possible duplicate entries")).toBeTruthy();
    expect(screen.queryByText("1 bill with no payment recorded")).toBeNull();
    expect(screen.getByText("1 found")).toBeTruthy();
  });

  it("reports the period as clear when the only finding is outstanding", () => {
    render(<PatternsCard anomalies={[missedBill]} fmt={fmt} />);

    expect(screen.queryByText("1 bill with no payment recorded")).toBeNull();
    expect(screen.queryByText(/found$/)).toBeNull();
    expect(screen.getByText(/this period tracks the baseline months/)).toBeTruthy();
  });
});
