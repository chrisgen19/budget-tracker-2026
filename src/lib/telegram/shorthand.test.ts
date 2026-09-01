import { describe, expect, it } from "vitest";
import { isPlainShorthand, namesDaypart } from "@/lib/telegram/shorthand";

describe("isPlainShorthand", () => {
  it("keeps the fast path for a message with no time in it", () => {
    // Meal words moved to `namesDaypart`: still fast-path as far as THIS function is
    // concerned, but the bot now diverts them when Gemini can resolve them. See below.
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

describe("namesDaypart", () => {
  // The bug this covers: TEMPORAL_HINT had no meal words, so "350 dinner" took the fast path and
  // was stamped with the current instant. Logging last night's dinner over breakfast filed it at
  // 08:00, and that invented clock then drove label schedule matching.
  it("spots a meal or part of the day", () => {
    for (const text of [
      "350 dinner",
      "100 breakfast",
      "250.50 jollibee lunch",
      "80 merienda",
      "120 almusal",
      "200 hapunan sa labas",
      "90 afternoon snack",
      "300 BRUNCH",
    ]) {
      expect(namesDaypart(text)).toBe(true);
    }
  });

  it("does not fire on an ordinary description", () => {
    for (const text of [
      "1500 internet bill",
      "+5000 salary",
      "450 grab to office",
      "200 luncheon meat",
      "300 dinnerware set",
    ]) {
      expect(namesDaypart(text)).toBe(false);
    }
  });

  // The two hints are deliberately separate. A daypart is only *softly* temporal: people log
  // breakfast at breakfast, so the current instant is often right and never absurd, which is what
  // lets the caller keep the fast path when there is no model to resolve it. "yesterday" has no
  // such defence and stays an unconditional divert.
  it("leaves the hard temporal divert alone, so a daypart alone keeps the fast path", () => {
    expect(isPlainShorthand("350 dinner")).toBe(true);
    expect(isPlainShorthand("350 dinner yesterday")).toBe(false);
    expect(isPlainShorthand("350 dinner 18:00")).toBe(false);
  });
});
