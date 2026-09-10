import { describe, expect, it } from "vitest";
import { buildTransactionParams } from "@/hooks/use-transactions";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";
import {
  buildTransactionWhere,
  parseTransactionSearchParams,
  transactionFilterSchema,
} from "@/lib/transaction-filter-query";
import {
  buildTransactionsHref,
  hasTransactionFilterParams,
  readTransactionFilters,
} from "@/lib/transaction-filter-url";

/** UTC+8 in `getTimezoneOffset` convention; "now" only matters for the month fallback. */
const MANILA = -480;

const queryOf = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

describe("buildTransactionsHref", () => {
  it("carries a category drill-down with its window and type", () => {
    const href = buildTransactionsHref({
      type: "EXPENSE",
      categoryId: "cat-1",
      from: "2026-01-15",
      to: "2026-03-03",
    });
    expect(href).toBe(
      "/transactions?type=EXPENSE&categoryId=cat-1&period=custom&from=2026-01-15&to=2026-03-03",
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

  it("drops a malformed or impossible day instead of sending it to the API", () => {
    expect(buildTransactionsHref({ labelId: "l1", from: "2026-9-1", to: "2026-09-30" })).toBe(
      "/transactions?labelId=l1",
    );
    // Date.UTC would roll 2026-02-31 forward to March 3 rather than complain.
    expect(buildTransactionsHref({ labelId: "l1", from: "2026-02-01", to: "2026-02-31" })).toBe(
      "/transactions?labelId=l1",
    );
  });

  it("drops a backwards window", () => {
    expect(
      buildTransactionsHref({ categoryId: "c1", from: "2026-09-30", to: "2026-09-02" }),
    ).toBe("/transactions?categoryId=c1");
  });

  it("round-trips through the reader", () => {
    const drillDown = {
      type: "INCOME" as const,
      labelId: "label-9",
      from: "2026-02-01",
      to: "2026-02-28",
    };
    const filters = readTransactionFilters(queryOf(buildTransactionsHref(drillDown)), MANILA);
    expect(filters).toMatchObject({ ...drillDown, period: "custom", month: "ALL" });
  });
});

describe("readTransactionFilters", () => {
  it("parks the month at ALL when a window arrives, since the two are alternatives", () => {
    const filters = readTransactionFilters(
      new URLSearchParams({ month: "2026-02", from: "2026-01-15", to: "2026-03-03" }),
      MANILA,
    );
    expect(filters).toMatchObject({ month: "ALL", period: "custom", from: "2026-01-15" });
  });

  it("leaves period null when there is no window, so the month stays authoritative", () => {
    const filters = readTransactionFilters(new URLSearchParams({ month: "2026-02" }), MANILA);
    expect(filters).toMatchObject({ month: "2026-02", period: null, from: null, to: null });
  });

  it("keeps a well-formed month and honours ALL", () => {
    expect(readTransactionFilters(new URLSearchParams({ month: "ALL" }), MANILA).month).toBe("ALL");
  });

  it("falls back to the current account month for a malformed one", () => {
    const filters = readTransactionFilters(new URLSearchParams({ month: "nonsense" }), MANILA);
    expect(filters.month).toMatch(/^\d{4}-\d{2}$/);
    expect(filters.month).not.toBe("nonsense");
  });

  it("drops a half, backwards or impossible window rather than holding one the API refuses", () => {
    // Keeping any of these would leave every list request failing with a 400 and
    // no way out but editing the URL by hand.
    const queries: Record<string, string>[] = [
      { from: "2026-09-01" },
      { to: "2026-09-30" },
      { from: "2026-09-30", to: "2026-09-02" },
      { from: "2026-02-01", to: "2026-02-31" },
    ];
    for (const query of queries) {
      const filters = readTransactionFilters(new URLSearchParams(query), MANILA);
      expect(filters.period).toBeNull();
      expect(filters.from).toBeNull();
      expect(filters.to).toBeNull();
      // No window means the month fallback applies.
      expect(filters.month).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("ignores a type it does not recognise", () => {
    expect(readTransactionFilters(new URLSearchParams({ type: "TRANSFER" }), MANILA).type).toBe(
      "ALL",
    );
  });

  it("leaves the advanced filters at their defaults — a link cannot set them", () => {
    const filters = readTransactionFilters(
      new URLSearchParams({ categoryId: "c1", createdVia: "MCP", sortBy: "amount" }),
      MANILA,
    );
    expect(filters).toMatchObject({
      categoryId: "c1",
      createdVia: "ALL",
      sortBy: "date",
      sortDir: "desc",
      amountMin: null,
      amountMax: null,
    });
  });

  it("drops an id longer than the API accepts", () => {
    const filters = readTransactionFilters(
      new URLSearchParams({ categoryId: "c".repeat(101), labelId: "l".repeat(101) }),
      MANILA,
    );
    expect(filters.categoryId).toBeNull();
    expect(filters.labelId).toBeNull();

    const atLimit = readTransactionFilters(
      new URLSearchParams({ categoryId: "c".repeat(100) }),
      MANILA,
    );
    expect(atLimit.categoryId).toBe("c".repeat(100));
  });

  it("truncates an oversized search rather than failing the API's ceiling", () => {
    const filters = readTransactionFilters(
      new URLSearchParams({ search: "x".repeat(500) }),
      MANILA,
    );
    expect(filters.search.length).toBe(MAX_TRANSACTION_SEARCH_LENGTH);
  });
});

describe("hasTransactionFilterParams", () => {
  it("is false for a bare URL and for one carrying only a highlight", () => {
    expect(hasTransactionFilterParams(new URLSearchParams())).toBe(false);
    expect(hasTransactionFilterParams(new URLSearchParams({ highlight: "tx-1" }))).toBe(false);
  });

  it("is true for anything the list should be steered by", () => {
    expect(hasTransactionFilterParams(new URLSearchParams({ categoryId: "c1" }))).toBe(true);
    expect(hasTransactionFilterParams(new URLSearchParams({ from: "2026-09-12" }))).toBe(true);
    expect(hasTransactionFilterParams(new URLSearchParams({ period: "custom" }))).toBe(true);
  });
});

describe("the request the client builds is one the API accepts", () => {
  // The two halves are written in different files against the same param names,
  // and a rename on either side fails silently as a 400 the list shows as an
  // error state. Bind them together here.
  const parseAsServer = (filters: Parameters<typeof buildTransactionParams>[0]) =>
    transactionFilterSchema.safeParse(
      Object.fromEntries(
        new URLSearchParams(
          Object.fromEntries(buildTransactionParams(filters, 1, MANILA).entries()),
        ),
      ) as Record<string, string>,
    );

  it("accepts an ordinary month view", () => {
    const filters = readTransactionFilters(new URLSearchParams({ month: "2026-09" }), MANILA);
    expect(parseTransactionSearchParams(buildTransactionParams(filters, 1, MANILA))).toMatchObject({
      month: "2026-09",
      period: null,
      from: null,
      to: null,
    });
    expect(parseAsServer(filters).success).toBe(true);
  });

  it("accepts a drill-down window", () => {
    const filters = readTransactionFilters(
      queryOf(buildTransactionsHref({ categoryId: "c1", type: "EXPENSE", from: "2026-09-01", to: "2026-09-30" })),
      MANILA,
    );
    const parsed = parseTransactionSearchParams(buildTransactionParams(filters, 1, MANILA));
    expect(parsed).toMatchObject({
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
      month: "ALL",
      categoryId: "c1",
      type: "EXPENSE",
    });
  });
});

describe("an all-time URL", () => {
  it("stays all time instead of collapsing to the current month", () => {
    // period=all is what the API calls unbounded; month "ALL" is the client's
    // name for the same thing, and sends no period and no window.
    const filters = readTransactionFilters(new URLSearchParams({ period: "all" }), MANILA);
    expect(filters).toMatchObject({ month: "ALL", period: null, from: null, to: null });
  });

  it("still reaches the API as an unbounded request", () => {
    const filters = readTransactionFilters(new URLSearchParams({ period: "all" }), MANILA);
    const parsed = parseTransactionSearchParams(buildTransactionParams(filters, 1, MANILA));
    expect(parsed.month).toBe("ALL");
    expect(buildTransactionWhere("user-1", parsed).date).toBeUndefined();
  });

  it("reads a contradictory all-time-plus-window as the window it describes", () => {
    // The schema refuses bounds alongside All time, so holding both would leave
    // every request failing.
    const filters = readTransactionFilters(
      new URLSearchParams({ period: "all", from: "2026-09-01", to: "2026-09-30" }),
      MANILA,
    );
    expect(filters).toMatchObject({ period: "custom", from: "2026-09-01", month: "ALL" });
  });
});
