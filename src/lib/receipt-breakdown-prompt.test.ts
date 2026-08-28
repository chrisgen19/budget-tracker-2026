import { describe, expect, it } from "vitest";
import { buildBreakdownPrompt, BREAKDOWN_CATEGORY_RULES } from "@/lib/receipt-breakdown-prompt";
import { DEFAULT_CATEGORIES } from "@/lib/default-categories";

const PROMPT = buildBreakdownPrompt('- "Groceries" (id: "cat_1")', "2026-08-26");

const ruleFor = (category: string) =>
  PROMPT.split("\n").find((l) => new RegExp(`^\\d+\\. ${category}:`).test(l.trim())) ?? "";

/**
 * The bug these cover: this prompt is built inside the route handler, so nothing could reach it
 * from a unit test. Its category rules were changed to split Groceries out of Food & Dining and
 * to rename Household to Home Supplies, and a regression in either was invisible — a misrouted
 * line item still produces a perfectly well-formed breakdown. `receipt-scan.test.ts` does not
 * help: it drives `scanReceipt`, which builds a different prompt.
 */
describe("breakdown prompt category routing", () => {
  it("groups raw ingredients under Groceries, not Food & Dining", () => {
    const groceries = ruleFor("Groceries");
    const dining = ruleFor("Food & Dining");

    expect(groceries).not.toBe("");
    for (const item of ["fresh produce", "meat", "eggs", "rice", "canned food"]) {
      expect(groceries).toContain(item);
      expect(dining).not.toContain(item);
    }
  });

  it("keeps Food & Dining to what was ready to eat when bought", () => {
    const dining = ruleFor("Food & Dining");

    expect(dining).toContain("ready to eat as sold");
    // The rule that stops a supermarket receipt itemising back into Food & Dining.
    expect(PROMPT).toContain("Most items on a supermarket or wet-market receipt are Groceries");
  });

  it("sends cleaning supplies to Home Supplies and never to Housing", () => {
    const supplies = ruleFor("Home Supplies");

    expect(supplies).toContain("cleaning supplies");
    expect(supplies).toContain("garbage bags");
    // "Household" was one letter from "Housing" and silently resolved to it.
    expect(PROMPT).not.toContain("Household");
    expect(PROMPT).toContain("Never assign a supermarket line item to Housing");
  });

  it("names only categories that are actually seeded", () => {
    const seeded = new Set(DEFAULT_CATEGORIES.map((c) => c.name));

    // Read straight off the rule list. Parsing names back out of the rendered prompt needed a
    // heuristic to skip prose rules, and a long or punctuated name slipped through it unchecked.
    expect(BREAKDOWN_CATEGORY_RULES.length).toBeGreaterThan(3);
    for (const rule of BREAKDOWN_CATEGORY_RULES) {
      expect(seeded.has(rule.category), `rule names "${rule.category}"`).toBe(true);
    }
  });

  it("renders every rule into the prompt it ships", () => {
    // The list is only an invariant worth checking if the prompt is actually built from it.
    for (const rule of BREAKDOWN_CATEGORY_RULES) {
      expect(PROMPT).toContain(`${rule.category}: ${rule.matches}`);
    }
  });
});
