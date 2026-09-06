import { describe, it, expect } from "vitest";
import {
  estimateBillAmount,
  describeEstimateBasis,
  type EstimateSample,
} from "./bill-estimate";

/** Meralco's real 2026 history, the bill that motivated #217. */
const meralco2026: EstimateSample[] = [
  { year: 2026, month: 3, amount: 5300, at: Date.UTC(2026, 2, 15) },
  { year: 2026, month: 4, amount: 6513, at: Date.UTC(2026, 3, 15) },
  { year: 2026, month: 5, amount: 8564, at: Date.UTC(2026, 4, 15) },
  { year: 2026, month: 6, amount: 14126, at: Date.UTC(2026, 5, 15) },
  { year: 2026, month: 7, amount: 9970, at: Date.UTC(2026, 6, 15) },
  { year: 2026, month: 8, amount: 8350, at: Date.UTC(2026, 7, 15) },
  { year: 2026, month: 9, amount: 5990, at: Date.UTC(2026, 8, 15) },
];

describe("estimateBillAmount", () => {
  it("falls back to the budgeted figure when nothing has been paid", () => {
    expect(estimateBillAmount([], 10, 2026, 5500)).toEqual({
      amount: 5500,
      basis: "budgeted",
      sampleSize: 0,
    });
  });

  it("uses the same month a year ago once a year of history exists", () => {
    const e = estimateBillAmount(meralco2026, 6, 2027, 5500);
    expect(e.basis).toBe("same-month-last-year");
    expect(e.amount).toBe(14126);
  });

  // The point of the whole feature: an annual mean is wrong in both directions
  // every month. June is the peak and October is not, and one figure cannot be
  // both -- 8,402 would over-forecast October by ~2,400 and under-forecast June
  // by ~5,700.
  it("gives a seasonal bill a different figure for a hot and a cool month", () => {
    const june = estimateBillAmount(meralco2026, 6, 2027, 5500);
    const september = estimateBillAmount(meralco2026, 9, 2027, 5500);
    expect(june.amount).toBe(14126);
    expect(september.amount).toBe(5990);
    expect(june.amount).toBeGreaterThan(september.amount * 2);
  });

  it("averages the same month across several earlier years", () => {
    const e = estimateBillAmount(
      [
        { year: 2025, month: 6, amount: 10000, at: Date.UTC(2025, 5, 15) },
        { year: 2026, month: 6, amount: 14000, at: Date.UTC(2026, 5, 15) },
        { year: 2026, month: 1, amount: 5000, at: Date.UTC(2026, 0, 15) },
      ],
      6,
      2027,
      5500,
    );
    expect(e).toEqual({ amount: 12000, basis: "same-month-last-year", sampleSize: 2 });
  });

  // A month from the *same* year is not history for that year's forecast.
  it("ignores the same month in the year being forecast", () => {
    const e = estimateBillAmount(meralco2026, 6, 2026, 5500);
    expect(e.basis).toBe("last-payment");
  });

  // The case that made the fallback the last payment rather than a mean. October
  // is a cool month; a six-payment mean gives 8,919 because it drags June's
  // 14,126 across the year, while September's 5,990 is close to right.
  it("forecasts a cool month from the reading beside it, not a mean of the year", () => {
    const e = estimateBillAmount(meralco2026, 10, 2026, 5500);
    expect(e.basis).toBe("last-payment");
    expect(e.amount).toBe(5990);
    const sixMonthMean = Math.round((6513 + 8564 + 14126 + 9970 + 8350 + 5990) / 6);
    expect(e.amount).toBeLessThan(sixMonthMean - 2500);
  });

  // Year and month alone tie, so "the last payment" would have depended on the
  // order the caller fetched in -- and a bill paid twice in one month is exactly
  // where the two figures differ.
  it("picks the later of two payments in the same month, whatever the input order", () => {
    const early = { year: 2026, month: 7, amount: 100, at: Date.UTC(2026, 6, 3) };
    const late = { year: 2026, month: 7, amount: 900, at: Date.UTC(2026, 6, 28) };
    expect(estimateBillAmount([early, late], 8, 2026, 50).amount).toBe(900);
    expect(estimateBillAmount([late, early], 8, 2026, 50).amount).toBe(900);
  });

  it("takes the newest payment, so a drifted bill is not anchored to its past", () => {
    const drifted: EstimateSample[] = [
      { year: 2026, month: 1, amount: 100, at: Date.UTC(2026, 0, 15) },
      { year: 2026, month: 6, amount: 900, at: Date.UTC(2026, 5, 15) },
      { year: 2026, month: 7, amount: 950, at: Date.UTC(2026, 6, 15) },
    ];
    expect(estimateBillAmount(drifted, 8, 2026, 50).amount).toBe(950);
  });

  it("rounds to whole units — a forecast to the centavo is false precision", () => {
    const e = estimateBillAmount([{ year: 2026, month: 2, amount: 100.34, at: Date.UTC(2026, 1, 15) }], 3, 2026, 0);
    expect(Number.isInteger(e.amount)).toBe(true);
  });
});

describe("describeEstimateBasis", () => {
  it("never describes a guess as though it were the bill", () => {
    expect(describeEstimateBasis({ amount: 0, basis: "budgeted", sampleSize: 0 })).toContain(
      "no payments recorded yet",
    );
  });

  it("says how many readings a seasonal figure rests on", () => {
    expect(
      describeEstimateBasis({ amount: 0, basis: "same-month-last-year", sampleSize: 1 }),
    ).toBe("what this month cost last year");
    expect(
      describeEstimateBasis({ amount: 0, basis: "same-month-last-year", sampleSize: 3 }),
    ).toContain("3 previous years");
  });

  it("says the last-payment basis is provisional", () => {
    expect(describeEstimateBasis({ amount: 0, basis: "last-payment", sampleSize: 1 })).toContain(
      "too little history",
    );
  });
});
