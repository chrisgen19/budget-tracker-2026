import { describe, expect, it } from "vitest";
import { EXAMPLES_MESSAGE } from "@/lib/telegram/examples";
import { resolveCommand } from "@/lib/telegram/commands";
import { isPlainShorthand } from "@/lib/telegram/shorthand";

/**
 * The examples are a list to copy from, so each line has to be a message that actually works.
 * An example that the bot would not understand is worse than none: it teaches a phrasing that
 * fails and looks like the bot is broken.
 */
const backticked = [...EXAMPLES_MESSAGE.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe("EXAMPLES_MESSAGE", () => {
  it("offers a useful number of examples", () => {
    expect(backticked.length).toBeGreaterThan(12);
  });

  it("keeps every bare-word example resolvable without a model", () => {
    // These are the ones that must work even when Gemini is unavailable.
    for (const word of ["summary", "bills", "recent", "categories"]) {
      expect(backticked, word).toContain(word);
      expect(resolveCommand(word), word).not.toBeNull();
    }
  });

  it("shows logging examples that take the fast path", () => {
    expect(isPlainShorthand("100 breakfast")).toBe(true);
    expect(isPlainShorthand("250 jollibee lunch")).toBe(true);
    expect(backticked).toContain("100 breakfast");
  });

  // "spent 350 for groceries yesterday" is offered as an example precisely because it carries a
  // date, and that has to route to Gemini rather than being stamped with the current time.
  it("shows a dated example that correctly leaves the fast path", () => {
    expect(backticked).toContain("spent 350 for groceries yesterday");
    expect(isPlainShorthand("spent 350 for groceries yesterday")).toBe(false);
  });

  it("covers each family of question", () => {
    for (const fragment of [
      "am I spending more than last month",
      "show me the last 6 months",
      "what were my biggest expenses",
      "where did my work budget go",
      "did I pay meralco this month",
      "what did I buy at south supermarket",
      "what was on that receipt",
    ]) {
      expect(backticked, fragment).toContain(fragment);
    }
  });

  it("stays inside Telegram's message limit", () => {
    expect(EXAMPLES_MESSAGE.length).toBeLessThan(4096);
  });
});
