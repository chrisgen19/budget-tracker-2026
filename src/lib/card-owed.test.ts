import { describe, expect, it } from "vitest";
import { sumOwedOnCards } from "./card-owed";

describe("sumOwedOnCards", () => {
  it("counts an archived card that still owes money", () => {
    expect(
      sumOwedOnCards([
        { isActive: true, balance: 1000.1 },
        { isActive: false, balance: 2500.2 },
      ])
    ).toBe(3500.3);
  });

  it("is zero, not hidden, for an active card that owes nothing", () => {
    expect(sumOwedOnCards([{ isActive: true, balance: 0 }])).toBe(0);
  });

  it("is null with no cards, or only archived cards that are paid off", () => {
    expect(sumOwedOnCards([])).toBeNull();
    expect(sumOwedOnCards([{ isActive: false, balance: 0 }])).toBeNull();
  });

  it("shows a debt left on archived cards alone", () => {
    expect(sumOwedOnCards([{ isActive: false, balance: 76566.08 }])).toBe(76566.08);
  });
});
