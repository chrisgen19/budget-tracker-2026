import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransactionRowBadges } from "@/components/transactions/transaction-row-badges";

/**
 * The provenance marker is the visible half of `transactions.created_via`.
 *
 * A row that Claude wrote must be distinguishable from one the app wrote without changing any
 * filter, and just as importantly an app-written row must never carry the marker: a false
 * "Added by Claude" is a provenance lie, which is exactly what the column exists to prevent.
 */

describe("TransactionRowBadges", () => {
  it("marks a row created through MCP", () => {
    render(<TransactionRowBadges createdVia="MCP" />);
    expect(screen.getByLabelText("Added by Claude")).toBeDefined();
  });

  it("distinguishes a Telegram row from a Claude one", () => {
    // Both arrive through /api/mcp. Sharing one marker would have made the bot's rows claim
    // Claude wrote them, which is the misattribution this whole column exists to prevent.
    render(<TransactionRowBadges createdVia="TELEGRAM" />);
    expect(screen.getByLabelText("Added via Telegram")).toBeDefined();
    expect(screen.queryByLabelText("Added by Claude")).toBeNull();
  });

  it("does not mark an app row as Telegram", () => {
    render(<TransactionRowBadges createdVia="APP" />);
    expect(screen.queryByLabelText("Added via Telegram")).toBeNull();
  });

  it("does not mark a row created in the app", () => {
    render(<TransactionRowBadges createdVia="APP" />);
    expect(screen.queryByLabelText("Added by Claude")).toBeNull();
  });

  it("does not mark a row whose provenance is absent", () => {
    // Rows fetched before the column existed, or any caller that omits the field.
    render(<TransactionRowBadges />);
    expect(screen.queryByLabelText("Added by Claude")).toBeNull();
  });

  it("carries an accessible name, since the marker is icon-only", () => {
    render(<TransactionRowBadges createdVia="MCP" />);
    const marker = screen.getByRole("img", { name: "Added by Claude" });
    expect(marker.getAttribute("title")).toBe("Added by Claude");
  });

  it("still renders the itemized and bill markers", () => {
    // Moved here from the page unchanged; these had no coverage before either.
    render(<TransactionRowBadges receiptGroupId="grp_1" billId="bill_1" createdVia="APP" />);
    expect(screen.getByText("Itemized")).toBeDefined();
    expect(screen.getByText("Bill")).toBeDefined();
    expect(screen.queryByLabelText("Added by Claude")).toBeNull();
  });

  it("omits markers whose ids are absent", () => {
    render(<TransactionRowBadges receiptGroupId={null} billId={null} />);
    expect(screen.queryByText("Itemized")).toBeNull();
    expect(screen.queryByText("Bill")).toBeNull();
  });

  it("shows all three together when they all apply", () => {
    render(<TransactionRowBadges receiptGroupId="grp_1" billId="bill_1" createdVia="MCP" />);
    expect(screen.getByText("Itemized")).toBeDefined();
    expect(screen.getByText("Bill")).toBeDefined();
    expect(screen.getByLabelText("Added by Claude")).toBeDefined();
  });
});
