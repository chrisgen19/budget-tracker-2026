import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnalyticsLoadError } from "@/components/analytics/analytics-load-error";

describe("AnalyticsLoadError", () => {
  it("tells a direct oversized-range link how to recover without offering a futile retry", () => {
    render(<AnalyticsLoadError error={new Error("Date range cannot exceed 3,660 days")} onRetry={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Choose a shorter date range" })).toBeDefined();
    expect(screen.getByText(/Use the period picker above/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("keeps retry for a transient failure", () => {
    const onRetry = vi.fn();
    render(<AnalyticsLoadError error={new Error("Failed to fetch analytics")} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
