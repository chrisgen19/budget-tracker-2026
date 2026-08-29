import { describe, expect, it } from "vitest";
import {
  MAX_CORRECTION_CHARS,
  correctedDescription,
  isScanCorrection,
} from "@/lib/telegram/scan-correction";

/**
 * The rule is defined by exclusion, so the tests that matter are the ones proving the existing
 * behaviours still win. A correction that swallowed "100 breakfast" would stop the shorthand
 * logger working while any review was open.
 */
describe("isScanCorrection", () => {
  it("treats a plain description as a correction", () => {
    expect(isScanCorrection("groceries at SM")).toBe(true);
    expect(isScanCorrection("lunch with the team")).toBe(true);
    expect(isScanCorrection("Meralco bill")).toBe(true);
  });

  it("leaves yes and no to the confirmation step", () => {
    for (const reply of ["yes", "y", "ok", "sure", "save", "no", "nope", "cancel", "👍", "❌"]) {
      expect(isScanCorrection(reply)).toBe(false);
    }
  });

  it("leaves an amount-first message to the shorthand logger", () => {
    // The fall-through this replaces was deliberate: "typing another expense logs it rather than
    // being refused". That has to keep working while a review is open.
    expect(isScanCorrection("100 breakfast")).toBe(false);
    expect(isScanCorrection("+5000 salary")).toBe(false);
    expect(isScanCorrection("250.50 lunch")).toBe(false);
  });

  it("leaves commands alone, slash or bare", () => {
    for (const reply of ["/summary", "summary", "my bills please", "/help", "recent"]) {
      expect(isScanCorrection(reply)).toBe(false);
    }
  });

  it("rejects an unknown slash command rather than filing it as a description", () => {
    expect(isScanCorrection("/notacommand")).toBe(false);
  });

  it("rejects empty, whitespace-only and over-long replies", () => {
    expect(isScanCorrection("")).toBe(false);
    expect(isScanCorrection("   ")).toBe(false);
    expect(isScanCorrection("x".repeat(MAX_CORRECTION_CHARS + 1))).toBe(false);
    expect(isScanCorrection("x".repeat(MAX_CORRECTION_CHARS))).toBe(true);
  });
});

describe("correctedDescription", () => {
  it("trims, bounds and capitalises like the shorthand logger does", () => {
    expect(correctedDescription("  groceries at SM  ")).toBe("Groceries at SM");
    expect(correctedDescription("x".repeat(500))).toHaveLength(MAX_CORRECTION_CHARS);
  });
});
