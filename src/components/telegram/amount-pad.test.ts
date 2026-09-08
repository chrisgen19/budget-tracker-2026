import { describe, expect, it } from "vitest";
import { padAmount, padDisplay, pressKey } from "@/components/telegram/amount-pad";

/** Type a whole string of keys, the way a person actually reaches a figure. */
const type = (keys: string) => [...keys].reduce((acc, k) => pressKey(acc, k), "");

describe("pressKey", () => {
  it("builds a figure digit by digit", () => {
    expect(type("180")).toBe("180");
  });

  it("replaces a leading zero rather than accumulating it", () => {
    // "0" then "5" is 5, not "05". Reachable by tapping zero first, which people do.
    expect(type("05")).toBe("5");
  });

  it("writes a leading point as 0.", () => {
    expect(pressKey("", ".")).toBe("0.");
  });

  it("ignores a second decimal point", () => {
    // Ignored rather than replacing the first, which would move the decimal under the user's
    // fingers mid-entry.
    expect(pressKey("38.5", ".")).toBe("38.5");
  });

  it("stops at two decimals", () => {
    expect(type("38.567")).toBe("38.56");
  });

  it("stops at a readable number of whole digits", () => {
    // Not a validation rule -- the server owns that -- but a stuck key must not produce a figure
    // nobody can read back.
    expect(type("123456789")).toBe("1234567");
  });

  it("still accepts decimals after the integer cap", () => {
    expect(pressKey(pressKey("1234567", "."), "5")).toBe("1234567.5");
  });

  it("deletes one character at a time", () => {
    expect(pressKey("380", "back")).toBe("38");
    expect(pressKey("3", "back")).toBe("");
    expect(pressKey("", "back")).toBe("");
  });

  it("clears", () => {
    expect(pressKey("38.50", "clear")).toBe("");
  });

  it("ignores anything that is not a digit", () => {
    expect(pressKey("38", "x")).toBe("38");
  });
});

describe("padAmount", () => {
  it("reads a typed figure", () => {
    expect(padAmount("180")).toBe(180);
    expect(padAmount("38.50")).toBe(38.5);
  });

  it("refuses an entry that is not yet a figure", () => {
    // Null is what keeps the MainButton disabled, so there is no state where a tap submits
    // nothing.
    expect(padAmount("")).toBeNull();
    expect(padAmount("0.")).toBeNull();
  });

  it("refuses zero", () => {
    // The server refuses it too, but a zero-amount transaction is a real thing to write by
    // accident and nothing downstream would flag it, so the button never offers it.
    expect(padAmount("0")).toBeNull();
    expect(padAmount("0.00")).toBeNull();
  });

  it("rounds to two decimals, matching what is stored", () => {
    // `transactions.amount` is a Float. Rounding here as well as server-side means the figure on
    // the button is the figure in the ledger.
    expect(padAmount("38.999")).toBe(39);
  });
});

describe("padDisplay", () => {
  it("shows a zero rather than an empty field", () => {
    expect(padDisplay("")).toBe("0");
  });

  it("keeps a trailing point visible while it is being typed", () => {
    // A number cannot represent this state, which is why the entry is held as a string.
    expect(padDisplay("38.")).toBe("38.");
  });
});
