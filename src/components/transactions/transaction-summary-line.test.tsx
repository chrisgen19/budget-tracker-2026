import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransactionSummaryLine } from "@/components/transactions/transaction-summary-line";
import type { TransactionSummary } from "@/hooks/use-transactions";

const summary = (overrides: Partial<TransactionSummary> = {}): TransactionSummary => ({
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
      type="EXPENSE"
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
      type: "INCOME",
      summary: summary({ count: 4, income: 80000, expense: 0, net: 80000 }),
    });
    expect(screen.getByText("₱80,000.00 received · 4 transactions")).toBeTruthy();
  });

  it("signs the net, because All is the only view where the direction is in doubt", () => {
    renderLine({
      type: "ALL",
      summary: summary({ count: 32, income: 80000, expense: 45230, net: 34770 }),
    });
    expect(screen.getByText("+₱34,770.00 net · 32 transactions")).toBeTruthy();
  });

  it("signs a negative net too", () => {
    renderLine({ type: "ALL" });
    expect(screen.getByText("−₱2,500.00 net · 10 transactions")).toBeTruthy();
  });

  it("leaves a zero net unsigned, which would otherwise read as a rounding artefact", () => {
    renderLine({ type: "ALL", summary: summary({ count: 2, income: 500, expense: 500, net: 0 }) });
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

  it("keeps figures that did load when a later refetch fails", () => {
    // placeholderData holds the previous totals across a refetch, and stale totals
    // beat none: every write on this page invalidates them anyway.
    renderLine({ isError: true });
    expect(screen.getByText("₱2,500.00 spent · 10 transactions")).toBeTruthy();
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
