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
      "350 dinner 18:00",
      "200 lunch 12:30",
      "500 groceries 09:15",
      "350 lunch at noon",
      "200 taxi at midnight",
      "100 snack midday",
      "150 taxi tonight",
    ]) {
      expect(isPlainShorthand(text)).toBe(false);
    }
  });

  it("is case insensitive", () => {
    expect(isPlainShorthand("350 groceries YESTERDAY")).toBe(false);
  });

  it("ignores digit pairs that are not a valid clock time", () => {
    expect(isPlainShorthand("100 item 25:99")).toBe(true);
  });

  it("does not fire on a word that merely contains a temporal one", () => {
    expect(isPlainShorthand("100 mayonnaise")).toBe(true);
    expect(isPlainShorthand("250 decorations")).toBe(true);
  });

  // The bug this covers: month and day abbreviations matched as bare words. A bare one is not a
  // date anyway (it cannot place a transaction on a particular day), and several double as
  // ordinary words or names, so diverting on them only risked a refusal when GEMINI_API_KEY is
  // unset.
  it("keeps ordinary words that happen to be month or day abbreviations", () => {
    for (const text of [
      "500 may gift",
      "200 jan birthday present",
      "200 sun cream",
      "150 sat down meal",
      "1500 rent on monthly",
    ]) {
      expect(isPlainShorthand(text)).toBe(true);
    }
  });

  it("still diverts a month name that sits beside a day number", () => {
    for (const text of [
      "500 dinner sep 14",
      "300 lunch 14 aug",
      "250 groceries Dec 25",
      "700 gift december 25",
      "400 fare may 3",
    ]) {
      expect(isPlainShorthand(text)).toBe(false);
    }
  });

  it("diverts named days and 'on' plus an abbreviation", () => {
    expect(isPlainShorthand("500 gas on fri")).toBe(false);
    expect(isPlainShorthand("500 gas friday")).toBe(false);
    expect(isPlainShorthand("200 lunch next tuesday")).toBe(false);
  });
});
