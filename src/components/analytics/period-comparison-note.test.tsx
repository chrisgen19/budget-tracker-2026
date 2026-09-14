import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PeriodComparisonNote } from "./period-comparison-note";

const context = {
  requestedFrom: "2026-09-01",
  requestedTo: "2026-09-30",
  effectiveTo: "2026-09-15",
  isPartial: true,
  daysElapsed: 15,
  daysInPeriod: 30,
  currentCoveragePct: 80,
  previousCoveragePct: 87,
  comparisonStatus: "available" as const,
  coverageThresholdPct: 60,
};

describe("PeriodComparisonNote", () => {
  it("states that partial-period changes use the matching prior window", () => {
    render(<PeriodComparisonNote context={context} previousPeriodLabel="Aug 1 – Aug 15, 2026" />);

    expect(screen.getByText(/Showing 15 of 30 calendar days so far/)).toBeTruthy();
    expect(screen.getByText(/matching window in Aug 1 – Aug 15, 2026/)).toBeTruthy();
  });

  it("explains why a low-coverage comparison is hidden", () => {
    render(
      <PeriodComparisonNote
        context={{ ...context, comparisonStatus: "low-coverage", currentCoveragePct: 20 }}
        previousPeriodLabel="Aug 1 – Aug 15, 2026"
      />,
    );

    expect(screen.getByText(/Changes are hidden/)).toBeTruthy();
    expect(screen.getByText(/20% current, 87% previous/)).toBeTruthy();
  });
});
