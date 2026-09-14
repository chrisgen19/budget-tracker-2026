import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransactionSummaryLine } from "@/components/transactions/transaction-summary-line";
import type { TransactionSummary } from "@/hooks/use-transactions";

const summary = (overrides: Partial<TransactionSummary> = {}): TransactionSummary => ({
  type: "EXPENSE",
  count: 10,
  income: 0,
  expense: 2500,
  net: -2500,
  ...overrides,
});

const renderLine = (props: Partial<Parameters<typeof TransactionSummaryLine>[0]> = {}) =>
  render(
    <TransactionSummaryLine
      summary={summary()}
      isError={false}
      isPlaceholder={false}
      currency="PHP"
      hideAmounts={false}
      {...props}
    />,
  );

describe("the transaction summary line", () => {
  it("names the side of the ledger the type filter already picked", () => {
    renderLine();
    expect(screen.getByText("₱2,500.00 spent · 10 transactions")).toBeTruthy();
  });

  it("reads income as received, and takes its figure from the income total", () => {
    renderLine({
      summary: summary({ type: "INCOME", count: 4, income: 80000, expense: 0, net: 80000 }),
    });
    expect(screen.getByText("₱80,000.00 received · 4 transactions")).toBeTruthy();
  });

  it("signs the net, because All is the only view where the direction is in doubt", () => {
    renderLine({
      summary: summary({ type: "ALL", count: 32, income: 80000, expense: 45230, net: 34770 }),
    });
    expect(screen.getByText("+₱34,770.00 net · 32 transactions")).toBeTruthy();
  });

  it("signs a negative net too", () => {
    renderLine({ summary: summary({ type: "ALL" }) });
    expect(screen.getByText("−₱2,500.00 net · 10 transactions")).toBeTruthy();
  });

  it("leaves a zero net unsigned, which would otherwise read as a rounding artefact", () => {
    renderLine({ summary: summary({ type: "ALL", count: 2, income: 500, expense: 500, net: 0 }) });
    expect(screen.getByText("₱0.00 net · 2 transactions")).toBeTruthy();
  });

  it("agrees with the count on singular", () => {
    renderLine({ summary: summary({ count: 1 }) });
    expect(screen.getByText("₱2,500.00 spent · 1 transaction")).toBeTruthy();
  });

  it("drops the figure entirely when nothing matched", () => {
    renderLine({ summary: summary({ count: 0, income: 0, expense: 0, net: 0 }) });
    expect(screen.getByText("No transactions")).toBeTruthy();
  });

  it("redacts through the same mask the rest of the app uses", () => {
    renderLine({ hideAmounts: true });
    expect(screen.getByText("₱ •••••• spent · 10 transactions")).toBeTruthy();
  });

  it("keeps figures cached under these very filters when a refetch fails", () => {
    // Not placeholder data: this is the last true answer to the question being
    // asked, and every write on this page invalidates it anyway.
    renderLine({ isError: true });
    expect(screen.getByText("₱2,500.00 spent · 10 transactions")).toBeTruthy();
  });

  it("marks a carried-over total as provisional rather than passing it off as this one", () => {
    // placeholderData answers the *previous* filter set — another month, another
    // search — and one number gives the reader no way to notice.
    renderLine({ isPlaceholder: true });
    const line = screen.getByText("₱2,500.00 spent · 10 transactions");

    expect(line.getAttribute("aria-busy")).toBe("true");
    expect(line.className).toContain("opacity-50");
  });

  it("drops a carried-over total when the request it stood in for fails", () => {
    // Otherwise another window's figure sits there indefinitely, indistinguishable
    // from an answer.
    renderLine({ isPlaceholder: true, isError: true });

    expect(screen.getByText("Totals unavailable")).toBeTruthy();
    expect(screen.queryByText(/2,500/)).toBeNull();
  });

  it("claims nothing about freshness once the real answer lands", () => {
    renderLine();
    expect(screen.getByText("₱2,500.00 spent · 10 transactions").getAttribute("aria-busy")).toBeNull();
  });

  it("says so when the totals never arrived", () => {
    renderLine({ summary: undefined, isError: true });
    expect(screen.getByText("Totals unavailable")).toBeTruthy();
  });

  it("announces itself politely, since it changes without the user moving focus", () => {
    renderLine({ summary: undefined, isError: false });
    expect(screen.getByText("Loading…").getAttribute("aria-live")).toBe("polite");
  });
});
