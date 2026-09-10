import { describe, expect, it } from "vitest";
import { buildTransactionParams } from "@/hooks/use-transactions";
import {
  buildTransactionWhere,
  parseTransactionSearchParams,
} from "@/lib/transaction-filter-query";
import { buildTransactionsHref } from "@/lib/transaction-filter-url";
import { parseFilterParams } from "@/lib/transaction-period-url";

/** UTC+8 in `getTimezoneOffset` convention. */
const MANILA = -480;

const queryOf = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

describe("buildTransactionsHref", () => {
  it("carries a category drill-down with its window and type", () => {
    expect(
      buildTransactionsHref({
        type: "EXPENSE",
        categoryId: "cat-1",
        from: "2026-01-15",
        to: "2026-03-03",
      }),
    ).toBe(
      "/transactions?period=custom&from=2026-01-15&to=2026-03-03&type=EXPENSE&categoryId=cat-1",
    );
  });

  it("names the window custom rather than the period it came from", () => {
    // What reaches the list is a pair of days. Calling it "monthly" would invite a
    // later reader to recompute the window from a month it no longer knows.
    expect(queryOf(buildTransactionsHref({ from: "2026-09-01", to: "2026-09-30" })).get("period"))
      .toBe("custom");
  });

  it("passes the same day at both ends for a single heatmap day", () => {
    const params = queryOf(buildTransactionsHref({ from: "2026-09-12", to: "2026-09-12" }));
    expect(params.get("from")).toBe("2026-09-12");
    expect(params.get("to")).toBe("2026-09-12");
  });

  it("omits ALL and empty values rather than spelling out defaults", () => {
    expect(buildTransactionsHref({ type: "ALL", categoryId: null, labelId: "" })).toBe(
      "/transactions",
    );
  });

  it("emits no window at all rather than half of one", () => {
    // The schema refuses a half-specified range, because the selection endpoint
    // materialises bulk edits from these filters and a lost bound widens them.
    expect(buildTransactionsHref({ labelId: "l1", from: "2026-09-01" })).toBe(
      "/transactions?labelId=l1",
    );
    expect(buildTransactionsHref({ labelId: "l1", to: "2026-09-30" })).toBe(
      "/transactions?labelId=l1",
    );
  });

  it("drops a malformed, impossible or backwards window", () => {
    // Date.UTC would roll 2026-02-31 forward to March 3 rather than complain.
    for (const window of [
      { from: "2026-9-1", to: "2026-09-30" },
      { from: "2026-02-01", to: "2026-02-31" },
      { from: "2026-09-30", to: "2026-09-02" },
    ]) {
      expect(buildTransactionsHref({ labelId: "l1", ...window })).toBe("/transactions?labelId=l1");
    }
  });

  it("round-trips through the page's own reader", () => {
    const drillDown = {
      type: "INCOME" as const,
      labelId: "label-9",
      from: "2026-02-01",
      to: "2026-02-28",
    };
    expect(parseFilterParams(queryOf(buildTransactionsHref(drillDown)), MANILA)).toMatchObject({
      ...drillDown,
      period: "custom",
    });
  });
});

describe("the request the client builds is one the API accepts", () => {
  // The two halves are written in different files against the same param names,
  // and a rename on either side fails silently as a 400 the list shows as an
  // error state. Bind them together here.
  const asFilters = (href: string) => ({
    ...parseFilterParams(queryOf(href), MANILA),
    createdVia: "ALL" as const,
    amountMin: null,
    amountMax: null,
    sortBy: "date" as const,
    sortDir: "desc" as const,
  });

  it("accepts a drill-down window", () => {
    const filters = asFilters(
      buildTransactionsHref({ categoryId: "c1", type: "EXPENSE", from: "2026-09-01", to: "2026-09-30" }),
    );
    expect(parseTransactionSearchParams(buildTransactionParams(filters, 1, MANILA))).toMatchObject({
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
      categoryId: "c1",
      type: "EXPENSE",
    });
  });

  it("accepts an all-time view and asks the database for no date clause", () => {
    const filters = asFilters("/transactions?period=all");
    const parsed = parseTransactionSearchParams(buildTransactionParams(filters, 1, MANILA));
    expect(parsed.period).toBe("all");
    expect(buildTransactionWhere("user-1", parsed).date).toBeUndefined();
  });
});
