import { describe, expect, it } from "vitest";
import {
  QUICK_FARES,
  quickKeyboard,
  removeQuickKeyboard,
  wantsKeyboardOff,
} from "@/lib/telegram/quick-keyboard";
import { isPlainShorthand } from "@/lib/telegram/shorthand";
import { matchCategory, type BotCategory } from "@/lib/telegram/category-match";

/** The seeded defaults, in the order `get_category_list` returns them. */
const CATEGORIES: BotCategory[] = [
  "Entertainment",
  "Food & Dining",
  "Fun",
  "Groceries",
  "Healthcare",
  "Home Supplies",
  "Housing",
  "Other Expense",
  "Personal Care",
  "Shopping",
  "Transportation",
  "Utilities",
].map((name) => ({ id: name.toLowerCase(), name, type: "EXPENSE" }));

/** The shorthand path's own regex, from `bot.ts`. Copied deliberately: if it changes there and
 *  not here, these tests should stop describing reality and say so. */
const SHORTHAND = /^(\d+(?:\.\d+)?)\s+(.+)$/i;

describe("quick keyboard labels", () => {
  // The whole design rests on a button's label being sent verbatim as a message. A label that
  // does not parse is a button that answers with "I couldn't understand that command".
  it("every fare label is valid shorthand", () => {
    for (const label of QUICK_FARES) {
      expect(isPlainShorthand(label), `${label} must not look like a dated entry`).toBe(true);
      const match = SHORTHAND.exec(label);
      expect(match, `${label} must parse as <amount> <description>`).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(0);
      expect(match![2].trim().length).toBeGreaterThan(0);
    }
  });

  // The failure this prevents is silent: a relabelled button still logs, just into the wrong
  // category, and the spending only looks wrong months later in the breakdown.
  it("every fare label resolves to Transportation", () => {
    for (const label of QUICK_FARES) {
      const description = SHORTHAND.exec(label)![2];
      expect(matchCategory(description, "EXPENSE", CATEGORIES)?.name, label).toBe("Transportation");
    }
  });

  // "fare home (UV)" contains "home", and there are two categories whose names start with it.
  // `matchCategory` checks category names before keyword hints, so this is worth pinning.
  it("does not let 'home' in a fare label pull it into Housing or Home Supplies", () => {
    for (const label of QUICK_FARES) {
      const name = matchCategory(SHORTHAND.exec(label)![2], "EXPENSE", CATEGORIES)?.name;
      expect(name).not.toBe("Housing");
      expect(name).not.toBe("Home Supplies");
    }
  });

  it("carries the amounts the fares actually cost", () => {
    expect(QUICK_FARES).toContain("38 fare to office");
    expect(QUICK_FARES).toContain("80 fare home (UV)");
    expect(QUICK_FARES).toContain("95 fare home (UV + jeep)");
  });
});

describe("quickKeyboard", () => {
  it("stays up between messages and keeps typing visible as an option", () => {
    const kb = quickKeyboard();
    expect(kb.is_persistent).toBe(true);
    expect(kb.resize_keyboard).toBe(true);
    expect(kb.input_field_placeholder).toMatch(/type/i);
  });

  it("offers every fare", () => {
    const labels = quickKeyboard().keyboard.flat().map((b) => b.text);
    for (const fare of QUICK_FARES) expect(labels).toContain(fare);
  });

  it("removes the keyboard rather than replacing it with an empty one", () => {
    expect(removeQuickKeyboard()).toEqual({ remove_keyboard: true });
  });
});

describe("wantsKeyboardOff", () => {
  it("recognises the off words", () => {
    for (const text of ["/keyboard off", "/keyboard hide", "/keyboard  remove", "/KEYBOARD Off"]) {
      expect(wantsKeyboardOff(text), text).toBe(true);
    }
  });

  // Telegram appends @botname wherever more than one bot can see the message.
  it("recognises the off words with a bot suffix", () => {
    expect(wantsKeyboardOff("/keyboard@mybot off")).toBe(true);
  });

  // `\b` matches before punctuation as well as at a word end, so these all removed the keyboard.
  // Near misses rather than realistic input, but the predicate should mean what it says.
  it("does not treat a longer word starting with an off-token as the command", () => {
    for (const text of ["/keyboard off-topic", "/keyboard off.", "/keyboard off!", "/keyboard stopwatch"]) {
      expect(wantsKeyboardOff(text), text).toBe(false);
    }
  });

  // Showing an unwanted keyboard costs one command to undo. Failing to show a wanted one leaves
  // the user typing, which is the thing this exists to stop.
  it("shows the keyboard for anything else", () => {
    for (const text of ["/keyboard", "/keyboard on", "/keyboard please", "keyboard"]) {
      expect(wantsKeyboardOff(text), text).toBe(false);
    }
  });
});
