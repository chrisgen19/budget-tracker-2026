import { describe, expect, it } from "vitest";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";
import {
  buildTransactionsHref,
  hasTransactionFilterParams,
  readTransactionFilters,
} from "@/lib/transaction-filter-url";

/** UTC+8 in `getTimezoneOffset` convention; "now" only matters for the month fallback. */
const MANILA = -480;

const queryOf = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

describe("buildTransactionsHref", () => {
  it("carries a category drill-down with its period and type", () => {
    const href = buildTransactionsHref({
      type: "EXPENSE",
      categoryId: "cat-1",
      dateFrom: "2026-01-15",
      dateTo: "2026-03-03",
    });
    expect(href).toBe(
      "/transactions?type=EXPENSE&categoryId=cat-1&dateFrom=2026-01-15&dateTo=2026-03-03",
    );
  });

  it("passes the same day at both ends for a single heatmap day", () => {
    const href = buildTransactionsHref({
      type: "EXPENSE",
      dateFrom: "2026-09-12",
      dateTo: "2026-09-12",
    });
    expect(queryOf(href).get("dateFrom")).toBe("2026-09-12");
    expect(queryOf(href).get("dateTo")).toBe("2026-09-12");
  });

  it("omits ALL and empty values rather than spelling out defaults", () => {
    expect(buildTransactionsHref({ type: "ALL", categoryId: null, labelId: "" })).toBe(
      "/transactions",
    );
  });

  it("drops a malformed day instead of sending it to the API", () => {
    // The API rejects it with a 400; landing on an unfiltered list beats an error page.
    expect(buildTransactionsHref({ labelId: "l1", dateFrom: "2026-9-1" })).toBe(
      "/transactions?labelId=l1",
    );
  });

  it("drops a well-formed day that does not exist, matching what the API accepts", () => {
    expect(buildTransactionsHref({ labelId: "l1", dateFrom: "2026-02-31" })).toBe(
      "/transactions?labelId=l1",
    );
    expect(
      readTransactionFilters(new URLSearchParams({ dateFrom: "2026-02-31" }), MANILA).dateFrom,
    ).toBeNull();
  });

  it("round-trips through the reader", () => {
    const drillDown = {
      type: "INCOME" as const,
      labelId: "label-9",
      dateFrom: "2026-02-01",
      dateTo: "2026-02-28",
    };
    const filters = readTransactionFilters(queryOf(buildTransactionsHref(drillDown)), MANILA);
    expect(filters).toMatchObject(drillDown);
  });
});

describe("readTransactionFilters", () => {
  it("parks the month at ALL when a range arrives, since the two are alternatives", () => {
    const filters = readTransactionFilters(
      new URLSearchParams({ month: "2026-02", dateFrom: "2026-01-15", dateTo: "2026-03-03" }),
      MANILA,
    );
    expect(filters.month).toBe("ALL");
    expect(filters.dateFrom).toBe("2026-01-15");
  });

  it("keeps a well-formed month when no range is given", () => {
    expect(readTransactionFilters(new URLSearchParams({ month: "2026-02" }), MANILA).month).toBe(
      "2026-02",
    );
    expect(readTransactionFilters(new URLSearchParams({ month: "ALL" }), MANILA).month).toBe("ALL");
  });

  it("falls back to the current account month for a malformed one", () => {
    const filters = readTransactionFilters(new URLSearchParams({ month: "nonsense" }), MANILA);
    expect(filters.month).toMatch(/^\d{4}-\d{2}$/);
    expect(filters.month).not.toBe("nonsense");
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
    // Keeping it would leave every list request failing with a 400 and no way out
    // but editing the URL by hand.
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
    expect(hasTransactionFilterParams(new URLSearchParams({ dateFrom: "2026-09-12" }))).toBe(true);
  });
});

describe("a reversed range", () => {
  it("is dropped rather than held as state every request would fail on", () => {
    const filters = readTransactionFilters(
      new URLSearchParams({ dateFrom: "2026-09-30", dateTo: "2026-09-02" }),
      MANILA,
    );
    expect(filters.dateFrom).toBeNull();
    expect(filters.dateTo).toBeNull();
    // Both ends gone means no range, so the month fallback applies.
    expect(filters.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("is never emitted by the link builder either", () => {
    expect(buildTransactionsHref({ categoryId: "c1", dateFrom: "2026-09-30", dateTo: "2026-09-02" })).toBe(
      "/transactions?categoryId=c1",
    );
  });
});
