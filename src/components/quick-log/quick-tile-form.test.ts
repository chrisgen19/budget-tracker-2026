import { describe, expect, it } from "vitest";
import { parseAmount } from "@/components/quick-log/quick-tile-form";

/**
 * The amount field is an unrestricted text input -- `inputMode="decimal"` is a keyboard hint, not
 * a constraint -- so it receives pasted and typed text that is not a number. `Number.parseFloat`
 * alone accepts a numeric *prefix* and discards the rest, which is how `1,000` became 1.
 */
describe("parseAmount", () => {
  it("reads a plain amount", () => {
    expect(parseAmount("38")).toBe(38);
    expect(parseAmount("38.0")).toBe(38);
    expect(parseAmount(" 250 ")).toBe(250);
    expect(parseAmount("1,234,567.89")).toBe(1234567.89);
  });

  it("reads a pasted amount carrying thousands separators", () => {
    // Refusing this would return null, and on the tile form null is a *meaningful* state -- "ask
    // each time" -- so the paste would silently change what the button does instead.
    expect(parseAmount("1,000")).toBe(1000);
  });

  it("refuses a string that is not wholly a number", () => {
    // Each of these came back as a number before: 1, 12, 1, 1.2 and 1000 respectively. The typed
    // text stayed on screen while the wrong figure was written, which on the amount prompt is one
    // tap from a transaction off by a factor of a thousand.
    expect(parseAmount("1 000")).toBeNull();
    expect(parseAmount("12abc")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
    expect(parseAmount("1e3")).toBeNull();
    expect(parseAmount("₱38")).toBeNull();
    expect(parseAmount("1,00")).toBeNull();
  });

  it("refuses more precision than a currency amount can hold", () => {
    // `amount` is a Float and every formatter here renders two places, so 38.999 was stored and
    // logged exactly while the card, the toast and the ledger all showed 39.00. Refused rather
    // than rounded: rounding decides for the user, and the refusal is visible on the form.
    expect(parseAmount("38.999")).toBeNull();
    expect(parseAmount("1,000.12345")).toBeNull();
    expect(parseAmount("1.999")).toBeNull();
    // Two places and fewer still read normally.
    expect(parseAmount("38.99")).toBe(38.99);
    expect(parseAmount("38.9")).toBe(38.9);
  });

  it("treats empty and non-positive as the asking state", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("0.")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
  });
});
