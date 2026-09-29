import { describe, it, expect } from "vitest";
import { roundMoney } from "./money";

describe("roundMoney", () => {
  it("strips float noise from a sum", () => {
    expect(roundMoney(81578.35000000002)).toBe(81578.35);
    expect(roundMoney(-1624.6900000000169)).toBe(-1624.69);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it("leaves clean values alone", () => {
    expect(roundMoney(22000)).toBe(22000);
    expect(roundMoney(0)).toBe(0);
  });
});
