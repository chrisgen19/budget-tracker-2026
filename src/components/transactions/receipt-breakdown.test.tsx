import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReceiptBreakdown, toReceiptBreakdownMeta } from "./receipt-breakdown";

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

/**
 * The collapsed default. A breakdown may carry up to MAX_BREAKDOWN_LINE_ITEMS rows per group,
 * and this renders inside a keyboard-aware modal on mobile, so opening expanded is the wrong
 * default at that size. Both call sites want collapsed; the prop existing at all is what lets
 * one of them change its mind later.
 */
describe("ReceiptBreakdown expansion", () => {
  const breakdown = {
    total: 30,
    items: [
      { name: "Rice 5kg", amount: 10 },
      { name: "Detergent", amount: 20 },
    ],
  };

  it("renders collapsed by default, so a long list is not painted on open", () => {
    render(<ReceiptBreakdown breakdown={breakdown} currency="PHP" />);

    expect(screen.queryByText("Rice 5kg")).toBeNull();
  });

  it("expands on click", () => {
    render(<ReceiptBreakdown breakdown={breakdown} currency="PHP" />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Rice 5kg")).toBeDefined();
  });

  it("still honours an explicit defaultExpanded", () => {
    render(<ReceiptBreakdown breakdown={breakdown} currency="PHP" defaultExpanded />);

    expect(screen.getByText("Rice 5kg")).toBeDefined();
  });
});

/**
 * Collapsed became the default in the same change, which makes the hidden state the normal one.
 * Without aria-expanded a screen-reader user hears only the heading and has no signal that
 * anything is behind it.
 */
describe("ReceiptBreakdown accessibility", () => {
  const breakdown = { total: 10, items: [{ name: "Rice 5kg", amount: 10 }] };

  it("reports its collapsed state and names the panel it controls", () => {
    render(<ReceiptBreakdown breakdown={breakdown} currency="PHP" />);
    const toggle = screen.getByRole("button");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBeTruthy();
  });

  it("updates the reported state when opened", () => {
    render(<ReceiptBreakdown breakdown={breakdown} currency="PHP" />);
    const toggle = screen.getByRole("button");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeTruthy();
  });
});
