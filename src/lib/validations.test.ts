import { describe, it, expect } from "vitest";
import {
  batchTransactionSchema,
  createMcpTokenSchema,
  receiptBreakdownMetaSchema,
} from "./validations";

/** What the multi-scan flow actually posts (use-multi-scan.ts). */
const validBlob = {
  total: 172,
  items: [
    { name: "Cheers Starch-Bsd Plate 9''6s", amount: 72 },
    { name: "Ecobag Large MH", amount: 10 },
  ],
};

const batchRow = (receiptBreakdown: unknown) => ({
  amount: 172,
  description: "Lawson",
  type: "EXPENSE" as const,
  date: "2026-03-05",
  categoryId: "c1",
  receiptBreakdown,
});

describe("receiptBreakdownMetaSchema", () => {
  it("accepts the shape the scan flow produces", () => {
    expect(receiptBreakdownMetaSchema.safeParse(validBlob).success).toBe(true);
  });

  // Before this schema the column was z.any(), so each of these could be persisted and
  // would then reach ReceiptBreakdown, which reads breakdown.items.length with no guard.
  const rejected: Array<[string, unknown]> = [
    ["a string", "not an object"],
    ["null", null],
    ["missing items", { total: 10 }],
    ["items not an array", { total: 10, items: "nope" }],
    ["an empty item list", { total: 10, items: [] }],
    ["an item without a name", { total: 10, items: [{ amount: 5 }] }],
    ["an item without an amount", { total: 10, items: [{ name: "x" }] }],
    ["a non-numeric amount", { total: 10, items: [{ name: "x", amount: "5" }] }],
    ["a missing total", { items: [{ name: "x", amount: 5 }] }],
    ["a non-numeric total", { total: "10", items: [{ name: "x", amount: 5 }] }],
  ];

  for (const [label, blob] of rejected) {
    it(`rejects ${label}`, () => {
      expect(receiptBreakdownMetaSchema.safeParse(blob).success).toBe(false);
    });
  }

  it("bounds the item count, so one row cannot carry an unbounded blob", () => {
    const many = (n: number) => ({
      total: n,
      items: Array.from({ length: n }, (_, i) => ({ name: `i${i}`, amount: 1 })),
    });

    expect(receiptBreakdownMetaSchema.safeParse(many(50)).success).toBe(true);
    expect(receiptBreakdownMetaSchema.safeParse(many(51)).success).toBe(false);
  });

  it("bounds the item name length", () => {
    const long = { total: 1, items: [{ name: "x".repeat(256), amount: 1 }] };
    expect(receiptBreakdownMetaSchema.safeParse(long).success).toBe(false);
  });

  it("rejects unknown keys rather than storing arbitrary payload in the JSON column", () => {
    const smuggled = { ...validBlob, extra: { anything: "at all" } };
    expect(receiptBreakdownMetaSchema.safeParse(smuggled).success).toBe(false);
  });
});

describe("batchTransactionSchema no longer accepts any receiptBreakdown", () => {
  it("accepts a well-formed one", () => {
    expect(batchTransactionSchema.safeParse(batchRow(validBlob)).success).toBe(true);
  });

  it("still allows the field to be absent", () => {
    expect(batchTransactionSchema.safeParse(batchRow(undefined)).success).toBe(true);
  });

  it("rejects a malformed one instead of persisting it", () => {
    expect(batchTransactionSchema.safeParse(batchRow({ items: "nope" })).success).toBe(false);
  });
});

describe("createMcpTokenSchema", () => {
  const base = { name: "laptop", expiresInDays: 90 };

  it("allows a read-only token that never expires", () => {
    // A credential that can only disclose is a contained risk, so an unbounded lifetime is a
    // reasonable choice to offer.
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["budget:read"],
      expiresInDays: null,
    });
    expect(result.success).toBe(true);
  });

  it("refuses a write token that never expires", () => {
    // Revocation only helps once the leak is noticed, so a writing credential has to age out.
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["transactions:write"],
      expiresInDays: null,
    });
    expect(result.success).toBe(false);
  });

  it("refuses a write token that outlives the write cap", () => {
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["budget:read", "transactions:write"],
      expiresInDays: 365,
    });
    expect(result.success).toBe(false);
  });

  it("allows a write token at exactly the cap", () => {
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["transactions:write"],
      expiresInDays: 90,
    });
    expect(result.success).toBe(true);
  });

  it("allows a read-only token to use the longer cap", () => {
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["budget:read"],
      expiresInDays: 365,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown scope", () => {
    const result = createMcpTokenSchema.safeParse({ ...base, scopes: ["transactions:destroy"] });
    expect(result.success).toBe(false);
  });
});
