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

  const missedBill = anomaly({
    kind: "missed-bill",
    scope: "outstanding",
    severity: "high",
    title: "1 bill with no payment recorded",
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
      missedBill,
    ]);

    const inPeriod = screen.getByRole("region", { name: "In this period" });
    const outstanding = screen.getByRole("region", { name: "Outstanding" });

    expect(inPeriod.textContent).toContain("2 possible duplicates");
    expect(inPeriod.textContent).not.toContain("1 bill with no payment recorded");
    expect(outstanding.textContent).toContain("1 bill with no payment recorded");
    expect(outstanding.textContent).not.toContain("2 possible duplicates");
  });

  /**
   * The February 2019 case. The panel as a whole is not empty, so the full "Nothing needs
   * attention" state cannot appear; the period has to say it is clean on its own, or the user is
   * left to infer it from a heading that is not there.
   */
  it("says the period is clean when only an outstanding finding exists", () => {
    renderWith([missedBill]);

    const inPeriod = screen.getByRole("region", { name: "In this period" });
    expect(inPeriod.textContent).toContain("No unusual spending, possible duplicates or logging gaps");
    expect(inPeriod.textContent).not.toContain("1 bill with no payment recorded");
    expect(screen.getByRole("region", { name: "Outstanding" }).textContent).toContain(
      "Still open today, whichever period is shown.",
    );
    expect(screen.queryByText("Nothing needs attention")).toBeNull();
  });

  it("leaves out the outstanding group when nothing is outstanding", () => {
    renderWith([anomaly({ kind: "logging-gap", scope: "period", title: "4 days with nothing logged" })]);

    expect(screen.getByRole("region", { name: "In this period" }).textContent).toContain(
      "4 days with nothing logged",
    );
    expect(screen.queryByRole("region", { name: "Outstanding" })).toBeNull();
  });

  it("never files a finding without a period scope under the period", () => {
    // A response from before `scope` existed, e.g. mid-deploy. Dropping the finding would hide a
    // missed bill; filing it under the period would repeat #340.
    renderWith([
      anomaly({ kind: "missed-bill", severity: "high", title: "1 bill with no payment recorded" }),
    ]);

    expect(screen.getByRole("region", { name: "In this period" }).textContent).not.toContain(
      "1 bill with no payment recorded",
    );
    expect(screen.getByRole("region", { name: "Outstanding" }).textContent).toContain(
      "1 bill with no payment recorded",
    );
  });

  it("no longer claims in the header that every finding is from this period", () => {
    renderWith([anomaly({ kind: "duplicate", scope: "period" })]);

    expect(screen.queryByText(/findings from this period/i)).toBeNull();
  });

  /**
   * Hide Amounts has nothing to mask here, by construction: `detail` is relative prose and the
   * figures travel in the numeric fields, which this panel does not render. If it ever starts to,
   * it needs `hideAmounts` threaded through first.
   */
  it("renders none of the numeric fields, so Hide Amounts has nothing to mask", () => {
    renderWith([
      anomaly({
        kind: "category-spike",
        scope: "period",
        title: "Groceries is running 80% above its usual",
        current: 12345,
        baseline: 6789,
        changePct: 80,
      }),
      anomaly({ ...missedBill, current: 4321 }),
    ]);

    const text = document.body.textContent ?? "";
    for (const figure of ["12345", "12,345", "6789", "6,789", "4321", "4,321"]) {
      expect(text).not.toContain(figure);
    }
  });
});
