import { describe, expect, it } from "vitest";
import {
  MAX_DEBT_TREND_MONTHS,
  OBSERVED_PAYMENT_MONTHS,
  buildCardCategoryBreakdown,
  monthlyPaymentTotals,
  monthsInRange,
  owedByMonth,
  computeAccountBalance,
  currentMonthKey,
  foldLedgerGroups,
  monthWindow,
  observedPaymentWindow,
  openingBalanceAsOf,
  shiftMonthKey,
  summariseObservedPayments,
} from "./credit-account-queries";

describe("openingBalanceAsOf", () => {
  const card = { openingBalance: 74270.8, openingBalanceDate: new Date("2026-09-14T16:00:00.000Z") };

  it("counts the opening balance for all time, or once its date has passed", () => {
    expect(openingBalanceAsOf(card)).toBe(74270.8);
    expect(openingBalanceAsOf(card, new Date("2026-09-30T15:59:59.999Z"))).toBe(74270.8);
  });

  // A dashboard month that ended before the card's opening date knows nothing of that debt.
  it("leaves it out of a month that ended before the opening date", () => {
    expect(openingBalanceAsOf(card, new Date("2026-08-31T15:59:59.999Z"))).toBe(0);
  });
});

/** Manila, in the `getTimezoneOffset()` convention the whole app uses. */
const MANILA = -480;

describe("computeAccountBalance", () => {
  it("is the opening balance plus purchases, less payments and credits", () => {
    // BPI: 74,270.80 already owed, the 6 August purchases, one 5,000 payment.
    expect(
      computeAccountBalance(74270.8, { purchases: 7295.28, payments: 5000, credits: 0 })
    ).toBe(76566.08);
  });

  it("takes refunds off", () => {
    expect(computeAccountBalance(0, { purchases: 500, payments: 0, credits: 200 })).toBe(300);
  });

  it("goes negative on an overpayment rather than clamping, since the card really holds a credit", () => {
    expect(computeAccountBalance(0, { purchases: 100, payments: 150, credits: 0 })).toBe(-50);
  });

  it("rounds away float noise, so a settled card reads zero rather than 1e-13", () => {
    expect(computeAccountBalance(0, { purchases: 0.1 + 0.2, payments: 0.3, credits: 0 })).toBe(0);
  });
});

describe("monthWindow", () => {
  it("bounds a month by the user's own midnights", () => {
    const { start, end } = monthWindow("2026-08", MANILA);

    expect(start.toISOString()).toBe("2026-07-31T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-31T15:59:59.999Z");
  });

  it("rolls December into the next year", () => {
    expect(monthWindow("2026-12", MANILA).end.toISOString()).toBe("2026-12-31T15:59:59.999Z");
  });
});

describe("currentMonthKey", () => {
  it("is the user's month, not UTC's, across the evening boundary", () => {
    expect(currentMonthKey(MANILA, new Date("2026-08-31T16:30:00.000Z"))).toBe("2026-09");
  });
});

describe("foldLedgerGroups", () => {
  it("adds purchases, and splits payments from credits, per card", () => {
    const totals = foldLedgerGroups(
      ["card-1", "card-2"],
      [{ creditAccountId: "card-1", _sum: { amount: 7295.28 } }],
      [
        { accountId: "card-1", kind: "PAYMENT", _sum: { amount: 5000 } },
        { accountId: "card-1", kind: "CREDIT", _sum: { amount: 385 } },
        { accountId: "card-2", kind: "PAYMENT", _sum: { amount: null } },
      ]
    );

    expect(totals.get("card-1")).toEqual({ purchases: 7295.28, payments: 5000, credits: 385 });
    expect(totals.get("card-2")).toEqual({ purchases: 0, payments: 0, credits: 0 });
  });

  it("ignores groups for cards it was not asked about", () => {
    const totals = foldLedgerGroups(
      ["card-1"],
      [{ creditAccountId: null, _sum: { amount: 1 } }],
      [{ accountId: "card-9", kind: "PAYMENT", _sum: { amount: 1 } }]
    );

    expect([...totals.keys()]).toEqual(["card-1"]);
  });
});

describe("buildCardCategoryBreakdown", () => {
  const categories = new Map([
    ["cat-subs", { name: "Subscriptions", icon: "Film", color: "#FF6B6B" }],
    ["cat-shop", { name: "Shopping", icon: "ShoppingBag", color: "#4ECDC4" }],
    ["cat-other", { name: "Other Expense", icon: "MoreHorizontal", color: "#8B7E6A" }],
  ]);

  it("totals the August purchases by category, largest first", () => {
    const rows = buildCardCategoryBreakdown(
      [
        { categoryId: "cat-other", _sum: { amount: 2230.67 } },
        { categoryId: "cat-shop", _sum: { amount: 1761.67 + 385 } },
        { categoryId: "cat-subs", _sum: { amount: 1424.15 + 1111 + 382.79 } },
      ],
      categories
    );

    expect(rows.map((row) => [row.name, row.amount])).toEqual([
      ["Subscriptions", 2917.94],
      ["Other Expense", 2230.67],
      ["Shopping", 2146.67],
    ]);
    expect(rows.reduce((sum, row) => sum + row.percentage, 0)).toBe(100);
  });

  it("drops a category it has no name for rather than rendering a blank row", () => {
    expect(buildCardCategoryBreakdown([{ categoryId: "gone", _sum: { amount: 10 } }], categories)).toEqual([]);
  });
});

describe("shiftMonthKey", () => {
  it("walks backwards across a year boundary", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-03", -6)).toBe("2025-09");
  });
});

describe("observedPaymentWindow", () => {
  /**
   * The window is the six *complete* months before this one. Letting it run to now would sweep in
   * the current month-to-date as well, so up to seven months of payments would be divided by six:
   * an average overstated by about a sixth, that jumps when this month's payment posts and drops
   * again at rollover.
   */
  it("stops at the start of the current month", () => {
    const now = new Date(Date.UTC(2026, 8, 21, 4)); // 21 September 2026, midday in Manila
    const window = observedPaymentWindow(MANILA, now);

    expect(window.firstMonth).toBe("2026-03");
    expect(window.lastMonth).toBe("2026-08");
    expect(window.start).toEqual(monthWindow("2026-03", MANILA).start);
    expect(window.end).toEqual(monthWindow("2026-09", MANILA).start);
  });

  it("spans exactly the configured number of whole months", () => {
    const now = new Date(Date.UTC(2026, 8, 21, 4));
    const { firstMonth, lastMonth } = observedPaymentWindow(MANILA, now);
    const [fy, fm] = firstMonth.split("-").map(Number);
    const [ly, lm] = lastMonth.split("-").map(Number);
    expect((ly - fy) * 12 + (lm - fm) + 1).toBe(OBSERVED_PAYMENT_MONTHS);
  });
});

describe("summariseObservedPayments", () => {
  const window = { firstMonth: "2026-03", lastMonth: "2026-08" };
  const paid = (month: string, amount: number) => ({
    amount,
    date: new Date(`${month}-15T04:00:00.000Z`),
  });

  /**
   * The bug this guards. A card first paid in July has two months of history, not six. Dividing
   * 8,000 by six gives 1,333, which on a 50,000 balance at 36% APR is below the 1,500 monthly
   * interest and reports "never clears" for someone paying it down at 4,000 a month.
   */
  it("divides by the months observed, not by the width of the window", () => {
    const result = summariseObservedPayments(
      [paid("2026-07", 4000), paid("2026-07", 4000), paid("2026-08", 4000)],
      window,
      MANILA
    );
    expect(result.months).toBe(2);
    expect(result.monthly).toBe(6000);
  });

  it("uses the full window for a card paid across all of it", () => {
    const payments = ["2026-03", "2026-05", "2026-08"].map((month) => paid(month, 6000));
    const result = summariseObservedPayments(payments, window, MANILA);
    expect(result.months).toBe(OBSERVED_PAYMENT_MONTHS);
    expect(result.monthly).toBe(3000);
  });

  /**
   * A quiet stretch *after* the first payment still counts, and should: someone who paid three
   * times in March and nothing since is not paying 6,000 a month.
   */
  it("keeps counting the months after payments stop", () => {
    const payments = Array.from({ length: 3 }, () => paid("2026-03", 6000));
    const result = summariseObservedPayments(payments, window, MANILA);
    expect(result.months).toBe(OBSERVED_PAYMENT_MONTHS);
    expect(result.monthly).toBe(3000);
  });

  it("reports nothing observed when there are no payments", () => {
    expect(summariseObservedPayments([], window, MANILA)).toEqual({ monthly: null, months: 0 });
  });

  /** Under three payments there is a span but no average: one transfer is not a habit. */
  it("still withholds the average below the payment floor", () => {
    const result = summariseObservedPayments([paid("2026-08", 5000)], window, MANILA);
    expect(result.monthly).toBeNull();
    expect(result.months).toBe(1);
  });
});

describe("monthlyPaymentTotals", () => {
  const on = (day: string, amount: number) => ({ amount, date: new Date(`${day}T04:00:00.000Z`) });

  /**
   * The minimum-only fix. The detector used to receive one entry per payment row, so three
   * part-payments in one month read as three minimum cycles. Grouped, they are one month.
   */
  it("adds part-payments in the same month into one total", () => {
    const totals = monthlyPaymentTotals(
      [on("2026-08-02", 1000), on("2026-08-12", 1000), on("2026-08-25", 1000)],
      ["2026-06", "2026-07", "2026-08"],
      MANILA
    );
    expect(totals).toEqual([
      { month: "2026-06", paid: 0 },
      { month: "2026-07", paid: 0 },
      { month: "2026-08", paid: 3000 },
    ]);
  });

  /** Built from the calendar, so a month with nothing paid is a zero rather than a closed gap. */
  it("keeps a month with no payment as zero", () => {
    const totals = monthlyPaymentTotals([on("2026-06-10", 500), on("2026-08-10", 500)], ["2026-06", "2026-07", "2026-08"], MANILA);
    expect(totals.map((cycle) => cycle.paid)).toEqual([500, 0, 500]);
  });

  /** A payment at 07:00 Manila on the 1st is still UTC's previous day, and belongs to the 1st. */
  it("files a payment by the user's own calendar, not UTC's", () => {
    const early = { amount: 700, date: new Date("2026-07-31T23:00:00.000Z") }; // 07:00 on 1 Aug in Manila
    expect(monthlyPaymentTotals([early], ["2026-07", "2026-08"], MANILA)).toEqual([
      { month: "2026-07", paid: 0 },
      { month: "2026-08", paid: 700 },
    ]);
  });
});

describe("monthsInRange", () => {
  it("lists every month from one to the other, inclusive", () => {
    expect(monthsInRange("2025-11-15", "2026-02-03")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  /**
   * A hand-picked cap of 60 cut a ten-year range half-way with nothing saying so. The cap is now
   * derived from the span the schema admits, so a valid range is never truncated.
   */
  it("never truncates the widest range the schema accepts", () => {
    const months = monthsInRange("2016-01-01", "2026-01-06"); // 3,658 days
    expect(months).toHaveLength(121);
    expect(months.at(-1)).toBe("2026-01");
    expect(months.length).toBeLessThanOrEqual(MAX_DEBT_TREND_MONTHS);
  });
});

describe("owedByMonth", () => {
  const card = { id: "c1", openingBalance: 0, openingBalanceDate: new Date("2026-01-01T00:00:00.000Z") };
  const at = (day: string) => new Date(`${day}T04:00:00.000Z`);

  it("builds each month's balance from everything up to that month's end", () => {
    const series = owedByMonth(
      [card],
      [
        { creditAccountId: "c1", amount: 10000, date: at("2026-06-10") },
        { creditAccountId: "c1", amount: 2000, date: at("2026-07-10") },
      ],
      [{ accountId: "c1", kind: "PAYMENT", amount: 3000, date: at("2026-07-20") }],
      ["2026-06", "2026-07", "2026-08"],
      MANILA
    );
    expect(series).toEqual([
      { month: "2026-06", owed: 10000 },
      { month: "2026-07", owed: 9000 },
      { month: "2026-08", owed: 9000 },
    ]);
  });

  /** A refund lowers the balance like a payment does; it just is not one. */
  it("subtracts credits as well as payments", () => {
    const series = owedByMonth(
      [card],
      [{ creditAccountId: "c1", amount: 5000, date: at("2026-06-10") }],
      [{ accountId: "c1", kind: "CREDIT", amount: 800, date: at("2026-06-15") }],
      ["2026-06"],
      MANILA
    );
    expect(series[0].owed).toBe(4200);
  });

  /** The first month still needs everything before the range, or it starts from zero. */
  it("counts history from before the range into the first month", () => {
    const series = owedByMonth(
      [card],
      [{ creditAccountId: "c1", amount: 7000, date: at("2026-02-10") }],
      [],
      ["2026-06"],
      MANILA
    );
    expect(series[0].owed).toBe(7000);
  });

  it("sums every card into one figure per month", () => {
    const series = owedByMonth(
      [card, { ...card, id: "c2" }],
      [
        { creditAccountId: "c1", amount: 1000, date: at("2026-06-10") },
        { creditAccountId: "c2", amount: 2500, date: at("2026-06-11") },
      ],
      [],
      ["2026-06"],
      MANILA
    );
    expect(series[0].owed).toBe(3500);
  });

  /**
   * The reviewer's case. A range ending on 15 June asks what was owed by the 15th. The last point
   * used to be measured at 30 June while the reads stopped at the 15th, so the two disagreed about
   * where the range ended. Now both stop at `to`, and a purchase on the 20th is outside the range
   * however it reaches this function.
   */
  it("measures a range that ends mid-month at its end, not at the month's", () => {
    const series = owedByMonth(
      [card],
      [
        { creditAccountId: "c1", amount: 4000, date: at("2026-06-10") },
        { creditAccountId: "c1", amount: 9000, date: at("2026-06-20") },
      ],
      [],
      ["2026-05", "2026-06"],
      MANILA,
      new Date(Date.UTC(2026, 5, 16) + MANILA * 60_000 - 1) // end of 15 June in Manila
    );
    expect(series).toEqual([
      { month: "2026-05", owed: 0 },
      { month: "2026-06", owed: 4000 },
    ]);
  });

  /** Earlier months are complete inside the range, so the range end must not clip them. */
  it("leaves every earlier month measured at its own end", () => {
    const series = owedByMonth(
      [card],
      [{ creditAccountId: "c1", amount: 3000, date: at("2026-05-28") }],
      [],
      ["2026-05", "2026-06"],
      MANILA,
      new Date(Date.UTC(2026, 5, 16) + MANILA * 60_000 - 1)
    );
    expect(series[0]).toEqual({ month: "2026-05", owed: 3000 });
  });

  /** Rows arrive in no particular order from the database; the walk must not depend on it. */
  it("gives the same answer whatever order the rows arrive in", () => {
    const rows = [
      { creditAccountId: "c1", amount: 2000, date: at("2026-07-10") },
      { creditAccountId: "c1", amount: 10000, date: at("2026-06-10") },
    ];
    const forward = owedByMonth([card], rows, [], ["2026-06", "2026-07"], MANILA);
    const reversed = owedByMonth([card], [...rows].reverse(), [], ["2026-06", "2026-07"], MANILA);
    expect(reversed).toEqual(forward);
  });
});
