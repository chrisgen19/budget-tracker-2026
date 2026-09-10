import { describe, expect, it } from "vitest";
import { buildTransactionParams } from "@/hooks/use-transactions";
import {
  buildTransactionWhere,
  parseTransactionSearchParams,
} from "@/lib/transaction-filter-query";
import { buildTransactionsHref } from "@/lib/transaction-filter-url";
import { filterSearchParams, parseFilterParams } from "@/lib/transaction-period-url";
import { analyticsReturnHref } from "@/lib/analytics-url";

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

describe("the way back survives the ledger's own mirror", () => {
  // This is the failure mode the whole `ret` plumbing exists to avoid. The page
  // rewrites its address bar from filterSearchParams on every filter change, and
  // that function writes a fixed set and drops the rest — so a return param the
  // serializer does not know about would survive until the first filter edit and
  // then vanish while the user is still on the page. #284's mirror erased a
  // drill-down's categoryId exactly this way.
  const RET = "period=custom&from=2026-07-01&to=2026-09-30&type=EXPENSE&tab=reports";

  it("arrives, is read back, and is written again", () => {
    const href = buildTransactionsHref({
      categoryId: "c1",
      type: "EXPENSE",
      from: "2026-09-01",
      to: "2026-09-30",
      ret: RET,
    });
    const arrived = parseFilterParams(queryOf(href), MANILA);
    expect(arrived.ret).toBe(RET);

    // What the mirror would write on the next filter edit.
    const mirrored = parseFilterParams(new URLSearchParams(filterSearchParams(arrived)), MANILA);
    expect(mirrored.ret).toBe(RET);
    expect(mirrored.categoryId).toBe("c1");
  });

  it("resolves to an analytics view, not to the window being filtered by", () => {
    // A heatmap day filters the ledger to one day while the period to return to is
    // the whole analytics span, so the two cannot be the same value.
    const href = buildTransactionsHref({ from: "2026-09-12", to: "2026-09-12", ret: RET });
    const arrived = parseFilterParams(queryOf(href), MANILA);

    expect(arrived).toMatchObject({ from: "2026-09-12", to: "2026-09-12" });
    expect(analyticsReturnHref(arrived.ret, MANILA)).toBe(
      "/analytics?period=custom&from=2026-07-01&to=2026-09-30&type=EXPENSE&tab=reports",
    );
  });

  it("offers no way back for a link that carries none", () => {
    const arrived = parseFilterParams(queryOf(buildTransactionsHref({ categoryId: "c1" })), MANILA);
    expect(arrived.ret).toBeNull();
    expect(analyticsReturnHref(arrived.ret, MANILA)).toBeNull();
  });
});
