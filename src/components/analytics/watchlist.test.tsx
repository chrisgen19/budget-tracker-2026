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
