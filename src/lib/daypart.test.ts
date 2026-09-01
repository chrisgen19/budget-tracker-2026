import { describe, expect, it } from "vitest";
import { DAYPART_GUIDANCE, DAYPART_TABLE, DAYPART_TIMES } from "@/lib/daypart";

describe("DAYPART_TIMES", () => {
  it("gives every daypart a real 24-hour clock time", () => {
    for (const { words, time } of DAYPART_TIMES) {
      expect(time, words).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(words.trim()).not.toBe("");
    }
  });

  // The table is read top to bottom by a model resolving "the most recent one that has passed",
  // so a row out of order would make that instruction contradict the data it operates on.
  it("runs forwards through the day", () => {
    const times = DAYPART_TIMES.map((d) => d.time);
    expect([...times].sort()).toEqual(times);
  });

  it("covers the words the Telegram shorthand diverter looks for", () => {
    const rendered = DAYPART_TABLE.toLowerCase();
    for (const word of ["breakfast", "brunch", "lunch", "merienda", "dinner"]) {
      expect(rendered, word).toContain(word);
    }
  });
});

describe("DAYPART_GUIDANCE", () => {
  it("embeds the table, so the rule and the times cannot drift apart", () => {
    expect(DAYPART_GUIDANCE).toContain(DAYPART_TABLE);
  });

  // The rule that earns the module: "350 dinner" at 10:00 is last night's meal. Resolving it to
  // today 19:00 stores a purchase in the future; falling back to the current clock files a dinner
  // at breakfast time. Both are wrong in a way only a chart reveals, weeks later.
  it("states the most-recent-occurrence rule and forbids a future timestamp", () => {
    expect(DAYPART_GUIDANCE).toMatch(/most\s+recent/i);
    expect(DAYPART_GUIDANCE).toMatch(/never return a timestamp in the future/i);
  });

  it("keeps an explicit time and a named day above the defaults", () => {
    expect(DAYPART_GUIDANCE).toMatch(/explicit time always wins/i);
    expect(DAYPART_GUIDANCE).toMatch(/yesterday dinner/i);
  });
});
