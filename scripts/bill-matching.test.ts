// @vitest-environment node
import { describe, it, expect } from "vitest";
import { descriptionCanMatch } from "./bill-matching";

describe("descriptionCanMatch", () => {
  it("matches a description unique among the user's bills", () => {
    expect(descriptionCanMatch("Meralco", ["Meralco", "PLDT Wifi", "Mirea Rent"])).toBe(true);
  });

  // `description` defaults to "" in the schema, so this is a real row, not a
  // hypothetical. An empty description identifies nothing and would match every
  // other blank-described transaction the user owns.
  it("refuses a blank description", () => {
    expect(descriptionCanMatch("", ["", "PLDT Wifi"])).toBe(false);
    expect(descriptionCanMatch("   ", ["   ", "PLDT Wifi"])).toBe(false);
  });

  // Two bills sharing a name would each match the same unlinked payment. Every
  // plan is built before any write lands, so both could claim it and the second
  // write would overwrite the first's billId -- leaving a log pointing at a
  // payment owned by another bill.
  it("refuses a description shared by two of the same user's bills", () => {
    expect(descriptionCanMatch("Internet", ["Internet", "Internet", "Meralco"])).toBe(false);
  });

  // The sibling list is scoped per user because the payment query is. Two
  // unrelated accounts both having a "Rent" bill must not make either ambiguous,
  // which would drop both users' description matching and report real repairs as
  // gaps.
  it("is unaffected by another user's identical bill name", () => {
    expect(descriptionCanMatch("Rent", ["Rent", "Meralco"])).toBe(true);
  });

  it("compares case- and whitespace-insensitively, as the payment query does", () => {
    expect(descriptionCanMatch("Internet", ["Internet", " internet ", "Meralco"])).toBe(false);
    expect(descriptionCanMatch(" Meralco ", ["Meralco", "PLDT Wifi"])).toBe(true);
  });
});
