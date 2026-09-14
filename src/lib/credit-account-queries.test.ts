import { describe, expect, it } from "vitest";
import {
  buildCardCategoryBreakdown,
  computeAccountBalance,
  currentMonthKey,
  foldLedgerGroups,
  monthWindow,
  sumOwedOnCards,
} from "./credit-account-queries";

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
