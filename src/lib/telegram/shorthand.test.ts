import { describe, expect, it } from "vitest";
import { isPlainShorthand } from "@/lib/telegram/shorthand";

describe("isPlainShorthand", () => {
  it("keeps the fast path for a message with no time in it", () => {
    for (const text of ["100 breakfast", "+5000 salary", "250.50 jollibee lunch", "1500 internet bill"]) {
      expect(isPlainShorthand(text)).toBe(true);
    }
  });

  // The bug this covers: the shorthand path stamps the current instant, so "350 groceries
  // yesterday" was filed under today with "yesterday" sitting in its own description, and the
  // invented timestamp then drove label auto-apply.
  it("gives up the fast path when the message says when it happened", () => {
    for (const text of [
      "350 groceries yesterday",
      "200 dinner last night",
      "120 coffee this morning",
      "500 gas on friday",
      "80 snacks 2 days ago",
      "1200 groceries 09/14",
      "400 lunch 2026-08-25",
      "300 dinner 7pm",
      "150 taxi tonight",
    ]) {
      expect(isPlainShorthand(text)).toBe(false);
    }
  });

  it("is case insensitive", () => {
    expect(isPlainShorthand("350 groceries YESTERDAY")).toBe(false);
  });

  it("does not fire on a word that merely contains a temporal one", () => {
    // "todays" and "agonist" would be false positives if the pattern were unanchored; a false
    // positive only costs one extra model call, but the fast path should still keep what it can.
    expect(isPlainShorthand("100 mayonnaise")).toBe(true);
    expect(isPlainShorthand("250 decorations")).toBe(true);
  });
});
