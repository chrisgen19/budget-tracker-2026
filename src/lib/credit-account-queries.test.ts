import { describe, expect, it } from "vitest";
import {
  buildCardCategoryBreakdown,
  computeAccountBalance,
  currentMonthKey,
  foldLedgerGroups,
  monthWindow,
} from "./credit-account-queries";

/** Manila, in the `getTimezoneOffset()` convention the whole app uses. */
const MANILA = -480;

describe("computeAccountBalance", () => {
  it("is what was charged, less what came back and what was paid", () => {
    // The August BPI statement: 7,295.28 charged, 5,000 paid.
    expect(computeAccountBalance(0, { charges: 7295.28, credits: 0, payments: 5000 })).toBe(
      2295.28
    );
  });

  it("starts from the opening balance", () => {
    expect(computeAccountBalance(1000, { charges: 500, credits: 200, payments: 300 })).toBe(1000);
  });

  it("goes negative on an overpayment rather than clamping, since the card really holds a credit", () => {
    expect(computeAccountBalance(0, { charges: 100, credits: 0, payments: 150 })).toBe(-50);
  });

  it("rounds away float noise, so a settled card reads zero rather than 1e-13", () => {
    expect(computeAccountBalance(0, { charges: 0.1 + 0.2, credits: 0, payments: 0.3 })).toBe(0);
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
    // 00:30 on 1 September in Manila is still 31 August in UTC.
    expect(currentMonthKey(MANILA, new Date("2026-08-31T16:30:00.000Z"))).toBe("2026-09");
  });
});

describe("foldLedgerGroups", () => {
  it("splits charges from credits and adds payments, per card", () => {
    const totals = foldLedgerGroups(
      ["card-1", "card-2"],
      [
        { accountId: "card-1", kind: "CHARGE", _sum: { amount: 7295.28 } },
        { accountId: "card-1", kind: "CREDIT", _sum: { amount: 385 } },
        { accountId: "card-2", kind: "CHARGE", _sum: { amount: null } },
      ],
      [{ creditAccountId: "card-1", _sum: { amount: 5000 } }]
    );

    expect(totals.get("card-1")).toEqual({ charges: 7295.28, credits: 385, payments: 5000 });
    expect(totals.get("card-2")).toEqual({ charges: 0, credits: 0, payments: 0 });
  });

  it("ignores groups for cards it was not asked about", () => {
    const totals = foldLedgerGroups(
      ["card-1"],
      [{ accountId: "card-9", kind: "CHARGE", _sum: { amount: 1 } }],
      [{ creditAccountId: null, _sum: { amount: 1 } }]
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

  it("totals the August statement by what it was spent on, largest first", () => {
    const rows = buildCardCategoryBreakdown(
      [
        { categoryId: "cat-other", kind: "CHARGE", _sum: { amount: 2230.67 } },
        { categoryId: "cat-shop", kind: "CHARGE", _sum: { amount: 1761.67 + 385 } },
        { categoryId: "cat-subs", kind: "CHARGE", _sum: { amount: 1424.15 + 1111 + 382.79 } },
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

  it("nets refunds against their category and drops one they fully cancel", () => {
    const rows = buildCardCategoryBreakdown(
      [
        { categoryId: "cat-shop", kind: "CHARGE", _sum: { amount: 385 } },
        { categoryId: "cat-shop", kind: "CREDIT", _sum: { amount: 385 } },
        { categoryId: "cat-subs", kind: "CHARGE", _sum: { amount: 1111 } },
        { categoryId: "cat-subs", kind: "CREDIT", _sum: { amount: 111 } },
      ],
      categories
    );

    expect(rows).toEqual([
      expect.objectContaining({ categoryId: "cat-subs", amount: 1000, percentage: 100 }),
    ]);
  });
});
