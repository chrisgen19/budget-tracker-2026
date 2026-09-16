import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Watchlist } from "@/components/analytics/watchlist";

const mocks = vi.hoisted(() => ({
  useAssessmentFactsQuery: vi.fn(),
}));

vi.mock("@/hooks/use-assessment", () => ({
  useAssessmentFactsQuery: mocks.useAssessmentFactsQuery,
}));

const period = { granularity: "monthly", from: "2026-09-01", to: "2026-09-30" };

describe("Watchlist", () => {
  it("shows deterministic findings and a drill-down for the selected period", () => {
    mocks.useAssessmentFactsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        facts: {
          anomalies: [
            {
              kind: "missed-bill",
              scope: "outstanding",
              severity: "high",
              title: "1 bill with no payment recorded",
              detail: "Internet — one due date passed without a payment.",
              current: null,
              baseline: null,
              changePct: null,
            },
          ],
        },
      },
    });

    render(
      <Watchlist
        period={period}
        returnTo="period=monthly&from=2026-09-01&to=2026-09-30&type=EXPENSE&tab=watchlist"
      />,
    );

    expect(screen.getByRole("heading", { name: "Watchlist" })).toBeTruthy();
    expect(screen.getByText("1 bill with no payment recorded")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByRole("link", { name: /view transactions in this period/i }).getAttribute("href")).toContain(
      "from=2026-09-01",
    );
  });

  it("makes the empty state explicit", () => {
    mocks.useAssessmentFactsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { facts: { anomalies: [] } },
    });

    render(<Watchlist period={period} returnTo="period=monthly" />);

    expect(screen.getByText("Nothing needs attention")).toBeTruthy();
  });

  it("offers a retry when the live facts request fails", () => {
    const refetch = vi.fn();
    mocks.useAssessmentFactsQuery.mockReturnValue({
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<Watchlist period={period} returnTo="period=monthly" />);

    screen.getByRole("button", { name: "Try again" }).click();
    expect(refetch).toHaveBeenCalledOnce();
  });
});

/**
 * The panel used to render every finding under "findings from this period". A missed bill is
 * judged against its own payment history rather than the window, so opening February 2019 -- a
 * month with no transactions at all -- reported a live 2026 overdue bill as though it belonged
 * there (#340).
 */
describe("Watchlist scope grouping", () => {
  const anomaly = (over: Record<string, unknown>) => ({
    severity: "medium",
    title: "t",
    detail: "d",
    current: null,
    baseline: null,
    changePct: null,
    ...over,
  });

  const renderWith = (anomalies: unknown[]) => {
    mocks.useAssessmentFactsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { facts: { anomalies } },
    });
    render(<Watchlist period={period} returnTo="period=monthly" />);
  };

  it("separates outstanding findings from ones measured in the period", () => {
    renderWith([
      anomaly({ kind: "duplicate", scope: "period", title: "2 possible duplicates" }),
      anomaly({ kind: "missed-bill", scope: "outstanding", title: "1 bill with no payment recorded" }),
    ]);

    const inPeriod = screen.getByRole("region", { name: "In this period" });
    const outstanding = screen.getByRole("region", { name: "Outstanding" });

    expect(inPeriod.textContent).toContain("2 possible duplicates");
    expect(inPeriod.textContent).not.toContain("1 bill with no payment recorded");
    expect(outstanding.textContent).toContain("1 bill with no payment recorded");
  });

  it("does not claim an outstanding finding belongs to the period", () => {
    renderWith([
      anomaly({ kind: "missed-bill", scope: "outstanding", title: "1 bill with no payment recorded" }),
    ]);

    // The section it sits in must not be the period one, even when it is the only finding.
    expect(screen.queryByRole("region", { name: "In this period" })).toBeNull();
    expect(screen.getByRole("region", { name: "Outstanding" })).toBeTruthy();
    expect(screen.getByText("True as of today, whichever period is shown.")).toBeTruthy();
  });

  it("omits a section that has no findings", () => {
    renderWith([anomaly({ kind: "logging-gap", scope: "period", title: "4 days with nothing logged" })]);

    expect(screen.getByRole("region", { name: "In this period" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Outstanding" })).toBeNull();
  });

  it("no longer claims in the header that every finding is from this period", () => {
    renderWith([anomaly({ kind: "duplicate", scope: "period" })]);

    expect(screen.queryByText(/findings from this period/i)).toBeNull();
  });
});
