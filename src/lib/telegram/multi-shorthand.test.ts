import { describe, expect, it } from "vitest";
import { parseShorthandEntries } from "@/lib/telegram/multi-shorthand";

const descriptions = (text: string) => parseShorthandEntries(text).map((e) => e.description);
const amounts = (text: string) => parseShorthandEntries(text).map((e) => e.amount);

describe("the bug this fixes (#204)", () => {
  // The old path took the first amount and swallowed the rest of the line into the description,
  // then reported success. `250 grab, 180 lunch` logged one row of 250 called "grab, 180 lunch".
  it("splits two transactions written in one message", () => {
    expect(parseShorthandEntries("250 grab, 180 lunch")).toEqual([
      { amount: 250, description: "grab", isIncome: false },
      { amount: 180, description: "lunch", isIncome: false },
    ]);
  });

  it("does not leave the second amount inside the first description", () => {
    for (const d of descriptions("250 grab, 180 lunch")) {
      expect(d).not.toContain("180");
    }
  });
});

describe("separators", () => {
  it("splits on a comma, a semicolon, a newline, or the word and", () => {
    expect(amounts("100 breakfast, 200 lunch")).toEqual([100, 200]);
    expect(amounts("100 breakfast; 200 lunch")).toEqual([100, 200]);
    expect(amounts("100 breakfast\n200 lunch")).toEqual([100, 200]);
    expect(amounts("100 breakfast and 200 lunch")).toEqual([100, 200]);
  });

  it("handles three or more", () => {
    expect(amounts("38 fare, 180 lunch, 80 fare home")).toEqual([38, 180, 80]);
  });

  it("keeps each type, so income and expense can share a message", () => {
    expect(parseShorthandEntries("+5000 salary, 250 lunch")).toEqual([
      { amount: 5000, description: "salary", isIncome: true },
      { amount: 250, description: "lunch", isIncome: false },
    ]);
  });

  it("tolerates ragged spacing and a trailing separator", () => {
    expect(amounts("250 grab ,  180 lunch")).toEqual([250, 180]);
    expect(descriptions("250 grab, 180 lunch,")).toEqual(["grab", "lunch"]);
  });
});

describe("what it deliberately refuses to split", () => {
  // A wrongly split row invents a transaction, which is worse than mis-describing one. Only a
  // deliberate separator counts, never bare whitespace before a number.
  it("does not split on whitespace before a number", () => {
    expect(descriptions("1500 internet bill 2026")).toEqual(["internet bill 2026"]);
    expect(descriptions("250 grab 2 way")).toEqual(["grab 2 way"]);
    expect(amounts("100 breakfast 200 lunch")).toEqual([100]);
  });

  it("keeps a comma clause that carries no amount of its own", () => {
    expect(descriptions("1500 groceries, milk and eggs")).toEqual(["groceries, milk and eggs"]);
    expect(descriptions("250 dinner, with mum and dad")).toEqual(["dinner, with mum and dad"]);
  });

  // "and" only starts an entry when an amount follows it.
  it("keeps 'and' inside a description when no amount follows", () => {
    expect(descriptions("250 lunch and coffee")).toEqual(["lunch and coffee"]);
  });

  // The label directive has to stay attached to the entry it follows, or `readLabelDirective`
  // never sees it and the label is silently dropped.
  it("keeps a trailing label directive with its transaction", () => {
    expect(descriptions("250 pickleball fee, label it work")).toEqual([
      "pickleball fee, label it work",
    ]);
    expect(descriptions("250 grab, #work")).toEqual(["grab, #work"]);
  });

  // The quick keyboard's own labels must survive untouched: "(UV + jeep)" contains a plus sign
  // and "fare home" contains no separator, so neither may be torn in half.
  it("leaves the quick keyboard's fare labels intact", () => {
    expect(parseShorthandEntries("38 fare to office")).toEqual([
      { amount: 38, description: "fare to office", isIncome: false },
    ]);
    expect(descriptions("95 fare home (UV + jeep)")).toEqual(["fare home (UV + jeep)"]);
  });
});

describe("falling through to the classifier", () => {
  it("returns nothing for a message that does not start with an amount", () => {
    expect(parseShorthandEntries("spent 350 on lunch")).toEqual([]);
    expect(parseShorthandEntries("what did I spend today")).toEqual([]);
    expect(parseShorthandEntries("")).toEqual([]);
  });

  it("returns nothing for an amount with no description", () => {
    expect(parseShorthandEntries("250")).toEqual([]);
    expect(parseShorthandEntries("250 ")).toEqual([]);
  });

  // Half a message understood is worse than none: the classifier can read the whole thing, and a
  // partial parse would log one row and quietly discard the other half.
  it("returns nothing when any clause is unusable", () => {
    expect(parseShorthandEntries("250 grab, 0 lunch")).toEqual([]);
  });
});

describe("single entries behave exactly as before", () => {
  it("parses the ordinary one-transaction shorthand", () => {
    expect(parseShorthandEntries("100 breakfast")).toEqual([
      { amount: 100, description: "breakfast", isIncome: false },
    ]);
    expect(parseShorthandEntries("250.50 lunch")).toEqual([
      { amount: 250.5, description: "lunch", isIncome: false },
    ]);
    expect(parseShorthandEntries("+5000 freelance payout")).toEqual([
      { amount: 5000, description: "freelance payout", isIncome: true },
    ]);
  });
});

describe("regex state", () => {
  // ENTRY_START is a module-level /g regex, so `lastIndex` persists between calls. Without a
  // reset the second call starts mid-string and silently returns different results.
  it("gives the same answer when called repeatedly", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(amounts("250 grab, 180 lunch"), `call ${i}`).toEqual([250, 180]);
    }
  });
});
