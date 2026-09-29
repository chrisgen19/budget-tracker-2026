import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { McpWriteAccess } from "./mcp-write-access";
import { FOREVER_LEASE_UNTIL } from "@/lib/validations";

afterEach(cleanup);

const renderPanel = (enabledUntil: string | null) => {
  const onChange = vi.fn().mockResolvedValue(undefined);
  render(<McpWriteAccess enabledUntil={enabledUntil} onChange={onChange} onReload={() => {}} />);
  return onChange;
};

describe("McpWriteAccess", () => {
  it("offers the long leases alongside the short ones", () => {
    renderPanel(null);
    for (const label of ["1 hour", "8 hours", "30 days", "90 days", "1 year", "forever"]) {
      expect(screen.getByRole("button", { name: `Enable ${label}` })).toBeDefined();
    }
  });

  it("sends forever by name rather than as a number of minutes", () => {
    const onChange = renderPanel(null);
    fireEvent.click(screen.getByRole("button", { name: "Enable forever" }));
    expect(onChange).toHaveBeenCalledWith("forever");
  });

  it("sends a year as minutes", () => {
    const onChange = renderPanel(null);
    fireEvent.click(screen.getByRole("button", { name: "Enable 1 year" }));
    expect(onChange).toHaveBeenCalledWith(365 * 24 * 60);
  });

  // The sentinel is 9999-12-31; printing it would read as a bug rather than as "no end".
  it("describes a forever lease without a date, and still offers turning it off", () => {
    renderPanel(FOREVER_LEASE_UNTIL.toISOString());
    expect(
      screen.getByText("Claude can add and change transactions until you turn it off.")
    ).toBeDefined();
    expect(screen.queryByText(/9999/)).toBeNull();
    expect(screen.getByRole("button", { name: "Turn off now" })).toBeDefined();
  });

  it("still prints the expiry of a timed lease", () => {
    const soon = new Date(Date.now() + 60 * 60_000).toISOString();
    renderPanel(soon);
    expect(screen.getByText(/Claude can add and change transactions until .+\d/)).toBeDefined();
  });
});
