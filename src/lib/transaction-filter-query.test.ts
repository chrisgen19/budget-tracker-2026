import { describe, expect, it } from "vitest";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";
import { transactionFilterSchema } from "@/lib/transaction-filter-query";

describe("transactionFilterSchema", () => {
  it("accepts the shared search ceiling and rejects one character beyond it", () => {
    expect(
      transactionFilterSchema.safeParse({ search: "x".repeat(MAX_TRANSACTION_SEARCH_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      transactionFilterSchema.safeParse({ search: "x".repeat(MAX_TRANSACTION_SEARCH_LENGTH + 1) })
        .success,
    ).toBe(false);
  });
});
