import { describe, it, expect } from "vitest";
import { toReceiptBreakdownMeta } from "./receipt-breakdown";

/**
 * Rows written before receiptBreakdownMetaSchema existed carry no guarantee, and the
 * component reads `breakdown.items.length` unguarded. Narrowing must degrade to null rather
 * than let a malformed row reach render.
 */
describe("toReceiptBreakdownMeta", () => {
  it("passes through a well-formed blob", () => {
    const result = toReceiptBreakdownMeta({
      total: 172,
      items: [{ name: "Ecobag", amount: 10 }],
    });

    expect(result).toEqual({ total: 172, items: [{ name: "Ecobag", amount: 10 }] });
  });

  const unusable: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "nope"],
    ["a number", 42],
    ["missing items", { total: 1 }],
    ["items not an array", { total: 1, items: {} }],
    ["an empty item list", { total: 1, items: [] }],
    ["items that are all malformed", { total: 1, items: [{ name: "x" }, { amount: 1 }, null] }],
    ["a NaN amount", { total: 1, items: [{ name: "x", amount: Number.NaN }] }],
  ];

  for (const [label, raw] of unusable) {
    it(`returns null for ${label}`, () => {
      expect(toReceiptBreakdownMeta(raw)).toBeNull();
    });
  }

  it("keeps the valid entries of a partly malformed blob", () => {
    const result = toReceiptBreakdownMeta({
      total: 40,
      items: [{ name: "Good", amount: 40 }, { name: "Bad" }, null],
    });

    expect(result?.items).toEqual([{ name: "Good", amount: 40 }]);
  });

  it("falls back to summing items when the stored total is unusable", () => {
    const result = toReceiptBreakdownMeta({
      items: [{ name: "A", amount: 30 }, { name: "B", amount: 12 }],
    });

    expect(result?.total).toBe(42);
  });
});
