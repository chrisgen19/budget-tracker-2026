import { describe, expect, it } from "vitest";
import { getReceiptItems } from "./budget-queries";
import { MAX_BREAKDOWN_GROUPS, MAX_BREAKDOWN_LINE_ITEMS } from "./receipt-limits";
import type { PrismaClient } from "./budget-query-types";

/** One transaction carrying `count` line items, as the stored blob shape. */
const txWith = (id: string, receiptGroupId: string, count: number) => ({
  id,
  description: `tx ${id}`,
  amount: count,
  date: new Date("2026-08-26T04:00:00.000Z"),
  receiptGroupId,
  category: { name: "Food & Dining" },
  receiptBreakdown: {
    total: count,
    items: Array.from({ length: count }, (_, i) => ({ name: `item ${i}`, amount: 1 })),
  },
});

/** Minimal injected client — the module takes Prisma by injection precisely so this is possible. */
const prismaWith = (transactions: unknown[]) =>
  ({
    transaction: { findMany: async () => transactions },
  }) as unknown as PrismaClient;

describe("getReceiptItems limit", () => {
  // A receipt is several transactions, one per category, each holding up to the item cap. A
  // single-blob default therefore truncated a perfectly ordinary itemized grocery run while
  // itemCount reported the full number — "two 100-item groups return 150 of 200".
  it("returns a whole receipt when one is named, across all its transactions", async () => {
    const prisma = prismaWith([
      txWith("t1", "grp_1", 100),
      txWith("t2", "grp_1", 100),
    ]);

    const result = await getReceiptItems(prisma, "u1", { receiptGroupId: "grp_1" });

    expect(result.itemCount).toBe(200);
    expect(result.items).toHaveLength(200);
    expect(result.truncated).toBe(false);
  });

  // Without a group filter this is "recent items across every receipt", where an unbounded
  // default would be a very different promise.
  it("defaults to one transaction's worth when no receipt is named", async () => {
    const prisma = prismaWith([txWith("t1", "grp_1", MAX_BREAKDOWN_LINE_ITEMS + 25)]);

    const result = await getReceiptItems(prisma, "u1", {});

    expect(result.items).toHaveLength(MAX_BREAKDOWN_LINE_ITEMS);
    expect(result.itemCount).toBe(MAX_BREAKDOWN_LINE_ITEMS + 25);
    expect(result.truncated).toBe(true);
  });

  // itemCount and totalAmount describe every match, so truncation has to be stated rather than
  // inferred: a caller that does not compare lengths reports a partial receipt as a whole one.
  it("flags truncation explicitly, and reports totals over every match", async () => {
    const prisma = prismaWith([txWith("t1", "grp_1", 10)]);

    const result = await getReceiptItems(prisma, "u1", { limit: 4 });

    expect(result.items).toHaveLength(4);
    expect(result.itemCount).toBe(10);
    expect(result.totalAmount).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it("does not flag truncation when everything fits", async () => {
    const prisma = prismaWith([txWith("t1", "grp_1", 3)]);

    const result = await getReceiptItems(prisma, "u1", {});

    expect(result.truncated).toBe(false);
    expect(result.items).toHaveLength(3);
  });

  it("can still return the largest receipt the schema permits", async () => {
    const prisma = prismaWith(
      Array.from({ length: MAX_BREAKDOWN_GROUPS }, (_, i) =>
        txWith(`t${i}`, "grp_1", MAX_BREAKDOWN_LINE_ITEMS)
      )
    );

    const result = await getReceiptItems(prisma, "u1", { receiptGroupId: "grp_1" });

    expect(result.items).toHaveLength(MAX_BREAKDOWN_GROUPS * MAX_BREAKDOWN_LINE_ITEMS);
    expect(result.truncated).toBe(false);
  });
});
