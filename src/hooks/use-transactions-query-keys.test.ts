import { describe, expect, it } from "vitest";
import { queryKeys } from "@/hooks/use-transactions";
import type { TransactionFilters } from "@/components/transactions/transaction-filters";

const filters: TransactionFilters = {
  search: "",
  type: "ALL",
  period: "monthly",
  from: "2026-08-01",
  to: "2026-08-31",
  categoryId: null,
  labelId: null,
  createdVia: "ALL",
  amountMin: null,
  amountMax: null,
  sortBy: "date",
  sortDir: "desc",
};

describe("transaction query keys", () => {
  it("separates response caches by timezone offset", () => {
    expect(queryKeys.transactions.list(filters, 1, -480)).not.toEqual(
      queryKeys.transactions.list(filters, 1, 420),
    );
    expect(queryKeys.transactions.infinite(filters, -480)).not.toEqual(
      queryKeys.transactions.infinite(filters, 420),
    );
    expect(queryKeys.dashboard.byMonth("2026-08", -480)).not.toEqual(
      queryKeys.dashboard.byMonth("2026-08", 420),
    );
  });
});
