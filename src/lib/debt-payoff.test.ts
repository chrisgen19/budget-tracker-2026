import { describe, expect, it } from "vitest";
import {
  MIN_PAYMENTS_FOR_AVERAGE,
  comparePayoffs,
  minimumDue,
  observedMonthlyPayment,
  payoffOnFixedPayment,
  payoffOnMinimum,
  type DebtTerms,
} from "@/lib/debt-payoff";

const FROM = new Date(Date.UTC(2026, 8, 21));
const terms = (over: Partial<DebtTerms> = {}): DebtTerms => ({
  balance: 48000,
  apr: 36,
  minimumPct: 5,
  minimumFloor: 500,
  ...over,
});

describe("minimumDue", () => {
  it("takes the greater of the percentage and the floor", () => {
    expect(minimumDue(48000, 5, 500)).toBe(2400);
    expect(minimumDue(4000, 5, 500)).toBe(500);
  });

  it("works with only one of the two set", () => {
    expect(minimumDue(48000, 5, null)).toBe(2400);
    expect(minimumDue(48000, null, 500)).toBe(500);
  });

  /** "No minimum is known" is not "the minimum is nothing". */
  it("is null when neither is set", () => {
    expect(minimumDue(48000, null, null)).toBeNull();
  });

  /** A card owing 200 against a 500 floor is billed the 200, not more than it owes. */
  it("never asks for more than the balance", () => {
    expect(minimumDue(200, 5, 500)).toBe(200);
  });
});

describe("payoffOnMinimum", () => {
  it("clears a card whose floor keeps the balance falling", () => {
    const result = payoffOnMinimum(terms(), FROM);
    expect(result.status).toBe("clears");
    if (result.status !== "clears") return;
    expect(result.months).toBeGreaterThan(0);
    expect(result.totalInterest).toBeGreaterThan(0);
    expect(result.payoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * The case that matters most and the reason `never-clears` is its own state. Reporting it as
   * "600 months" would be a fabricated number.
   *
   * The minimum is billed on the statement balance, interest included, so the break-even is not
   * simply "percentage equals the monthly rate": a percentage `p` of `balance * (1 + r)` clears
   * ground only when `(1 + r)(1 - p) < 1`, i.e. above `100r / (1 + r)`. At 36% APR (r = 3%) that
   * threshold is 2.91%, so a 2% minimum genuinely never gets anywhere.
   */
  it("reports never-clears when the minimum never beats the interest", () => {
    const result = payoffOnMinimum(terms({ minimumPct: 2, minimumFloor: null }), FROM);
    expect(result).toEqual({ status: "never-clears" });
  });

  /**
   * Just the other side of that threshold. A 3% minimum against 3% monthly interest does gain
   * ground, by about 0.09% of the balance a month, so it is `beyond-horizon` rather than
   * `never-clears` -- the distinction exists precisely so this case is not called hopeless.
   */
  it("reports the barely-ahead minimum as beyond the horizon, not as never", () => {
    const result = payoffOnMinimum(terms({ minimumPct: 3, minimumFloor: null }), FROM);
    expect(result).toEqual({ status: "beyond-horizon" });
  });

  /**
   * The units bug this guards: the minimum is capped at what is *owed* this cycle, not at the
   * pre-interest balance. Capping early leaves the interest behind every month, dragging the tail
   * out and making the minimum basis slower than a flat payment of the same size.
   */
  it("clears a tail month in one step, like a flat payment of the same size", () => {
    const viaMinimum = payoffOnMinimum(terms({ balance: 600, minimumPct: 5, minimumFloor: 500 }), FROM);
    const viaFlat = payoffOnFixedPayment(terms({ balance: 600 }), 500, FROM, "not-planned");
    expect(viaMinimum.status).toBe("clears");
    expect(viaFlat.status).toBe("clears");
    if (viaMinimum.status !== "clears" || viaFlat.status !== "clears") return;
    expect(viaMinimum.months).toBe(viaFlat.months);
  });

  it("is unknown, naming the missing minimum, when neither column is set", () => {
    expect(payoffOnMinimum(terms({ minimumPct: null, minimumFloor: null }), FROM)).toEqual({
      status: "unknown",
      reason: "no-minimum",
    });
  });

  it("reports a settled card rather than projecting one", () => {
    expect(payoffOnMinimum(terms({ balance: 0 }), FROM)).toEqual({ status: "settled" });
  });

  /** A credit on the card is not a debt to pay off. */
  it("treats a negative balance as settled", () => {
    expect(payoffOnMinimum(terms({ balance: -500 }), FROM)).toEqual({ status: "settled" });
  });
});

describe("payoffOnFixedPayment", () => {
  it("clears faster on a bigger payment, and costs less interest", () => {
    const small = payoffOnFixedPayment(terms(), 5000, FROM, "not-planned");
    const large = payoffOnFixedPayment(terms(), 8000, FROM, "not-planned");
    expect(small.status).toBe("clears");
    expect(large.status).toBe("clears");
    if (small.status !== "clears" || large.status !== "clears") return;
    expect(large.months).toBeLessThan(small.months);
    expect(large.totalInterest).toBeLessThan(small.totalInterest);
  });

  /** A genuine 0% installment plan: the balance divides evenly and costs nothing to carry. */
  it("charges no interest at 0% APR", () => {
    const result = payoffOnFixedPayment(terms({ apr: 0, balance: 12000 }), 1000, FROM, "not-planned");
    expect(result).toMatchObject({ status: "clears", months: 12, totalInterest: 0 });
  });

  it("reports never-clears when the payment is below the interest", () => {
    // 36% APR on 48,000 is 1,440 a month in interest.
    expect(payoffOnFixedPayment(terms(), 1000, FROM, "not-planned")).toEqual({
      status: "never-clears",
    });
  });

  /**
   * Beyond-horizon is distinct from never-clears: this balance *is* falling, just not within any
   * span worth quoting. Collapsing the two would tell someone making progress that they are not.
   *
   * A large 0% plan paid slowly, because that is the reachable case. Once a payment beats the
   * interest on an interest-bearing card the balance falls, the interest falls with it and the
   * payoff accelerates, so even a payment one centavo above the interest on 48,000 at 36% clears
   * inside 402 months. The horizon is a guard against an absurd answer, not a common outcome.
   */
  it("separates a balance that falls too slowly from one that never falls", () => {
    const slow = payoffOnFixedPayment(terms({ apr: 0, balance: 100000 }), 100, FROM, "not-planned");
    expect(slow).toEqual({ status: "beyond-horizon" });
  });

  /** The neighbouring case, to pin that the horizon is not swallowing ordinary slow payoffs. */
  it("still answers for a payment barely above the interest", () => {
    const result = payoffOnFixedPayment(terms(), 1441, FROM, "not-planned");
    expect(result.status).toBe("clears");
    if (result.status !== "clears") return;
    expect(result.months).toBeGreaterThan(200);
  });

  it("is unknown with the caller's reason when no payment is supplied", () => {
    expect(payoffOnFixedPayment(terms(), null, FROM, "too-little-history")).toEqual({
      status: "unknown",
      reason: "too-little-history",
    });
  });

  it("treats a zero payment on a real balance as never-clears", () => {
    expect(payoffOnFixedPayment(terms(), 0, FROM, "not-planned")).toEqual({ status: "never-clears" });
  });

  /** 31 January plus one month is February, not 3 March. */
  it("clamps the payoff date into a shorter month", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31));
    const result = payoffOnFixedPayment(terms({ apr: 0, balance: 100 }), 100, jan31, "not-planned");
    expect(result).toMatchObject({ status: "clears", months: 1, payoffDate: "2026-02-28" });
  });
});

describe("observedMonthlyPayment", () => {
  it("averages over the months in the window, not the number of payments", () => {
    const payments = [{ amount: 5000 }, { amount: 6000 }, { amount: 4000 }];
    // Three payments across six months is 2,500 a month, not 5,000.
    expect(observedMonthlyPayment(payments, 6)).toBe(2500);
  });

  /** One or two transfers is not a habit, and a payoff date off one would present it as a plan. */
  it("is null below the minimum number of payments", () => {
    const payments = Array.from({ length: MIN_PAYMENTS_FOR_AVERAGE - 1 }, () => ({ amount: 5000 }));
    expect(observedMonthlyPayment(payments, 6)).toBeNull();
  });

  it("is null on an empty window rather than dividing by zero", () => {
    expect(observedMonthlyPayment([{ amount: 1 }, { amount: 2 }, { amount: 3 }], 0)).toBeNull();
  });
});

describe("comparePayoffs", () => {
  /**
   * No APR withholds every column. A payoff date computed at 0% on a card charging 36% is not a
   * cautious estimate, it is a different card.
   */
  it("withholds all three bases without an APR, naming why", () => {
    const result = comparePayoffs({
      balance: 48000,
      apr: null,
      minimumPct: 5,
      minimumFloor: 500,
      plannedPayment: 8000,
      observedMonthly: 5333,
      from: FROM,
    });
    expect(result.minimum).toEqual({ status: "unknown", reason: "no-apr" });
    expect(result.observed).toEqual({ status: "unknown", reason: "no-apr" });
    expect(result.planned).toEqual({ status: "unknown", reason: "no-apr" });
  });

  /** Each column is withheld on its own account: a missing plan does not hide the minimum. */
  it("withholds only the bases that are missing their own input", () => {
    const result = comparePayoffs({
      balance: 48000,
      apr: 36,
      minimumPct: 5,
      minimumFloor: 500,
      plannedPayment: null,
      observedMonthly: null,
      from: FROM,
    });
    expect(result.minimum.status).toBe("clears");
    expect(result.observed).toEqual({ status: "unknown", reason: "too-little-history" });
    expect(result.planned).toEqual({ status: "unknown", reason: "not-planned" });
  });

  it("puts a plan ahead of the minimum it improves on", () => {
    const result = comparePayoffs({
      balance: 48000,
      apr: 36,
      minimumPct: 5,
      minimumFloor: 500,
      plannedPayment: 8000,
      observedMonthly: 5000,
      from: FROM,
    });
    if (result.minimum.status !== "clears") throw new Error("expected the minimum to clear");
    if (result.planned.status !== "clears") throw new Error("expected the plan to clear");
    expect(result.planned.months).toBeLessThan(result.minimum.months);
    expect(result.planned.totalInterest).toBeLessThan(result.minimum.totalInterest);
  });
});
