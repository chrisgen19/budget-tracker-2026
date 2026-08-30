import { describe, it, expect } from "vitest";
import { isSpending, netDelta, SPENDING_ONLY, asSpendingType } from "./transfer-filters";
import { generateTransactionsCsv } from "./transaction-csv";
import { selectTopTransactions } from "./analytics-compute";

describe("netDelta", () => {
  it("contributes nothing for a transfer", () => {
    // The regression this guards: `type === "INCOME" ? amount : -amount` files a transfer as an
    // expense, so paying a credit-card bill drops the running balance by the payment on top of
    // the purchases it settles — the money counted twice.
    expect(netDelta({ type: "TRANSFER", amount: 5_000 })).toBe(0);
  });

  it("still signs income and expenses the way the ternary did", () => {
    expect(netDelta({ type: "INCOME", amount: 100 })).toBe(100);
    expect(netDelta({ type: "EXPENSE", amount: 100 })).toBe(-100);
  });
});

describe("isSpending", () => {
  it("keeps both spending directions and drops transfers", () => {
    const rows = [
      { type: "INCOME" as const, amount: 1 },
      { type: "EXPENSE" as const, amount: 2 },
      { type: "TRANSFER" as const, amount: 3 },
    ];
    expect(rows.filter(isSpending).map((r) => r.type)).toEqual(["INCOME", "EXPENSE"]);
  });
});

describe("SPENDING_ONLY", () => {
  it("names both spending types and excludes TRANSFER", () => {
    expect(SPENDING_ONLY.type.in).toEqual(["INCOME", "EXPENSE"]);
    expect(SPENDING_ONLY.type.in).not.toContain("TRANSFER");
  });
});

describe("asSpendingType", () => {
  it("passes the two real directions through unchanged", () => {
    expect(asSpendingType("INCOME")).toBe("INCOME");
    expect(asSpendingType("EXPENSE")).toBe("EXPENSE");
  });
});

describe("generateTransactionsCsv", () => {
  it("exports a transfer as 0 so a summed column is not double-counted", () => {
    const rows = [
      {
        amount: 255,
        date: new Date("2026-07-15T02:00:00.000Z"),
        description: "GSM Green ride",
        type: "EXPENSE" as const,
        category: { name: "Transportation" },
      },
      {
        amount: 255,
        date: new Date("2026-08-05T02:00:00.000Z"),
        description: "BPI card payment",
        type: "TRANSFER" as const,
        category: { name: "Transfer" },
      },
    ];

    const lines = generateTransactionsCsv(rows, -480).split("\n");
    expect(lines[1].endsWith(",-255")).toBe(true);
    expect(lines[2].endsWith(",0")).toBe(true);
  });
});

describe("selectTopTransactions", () => {
  it("leaves transfers out of the biggest transactions", () => {
    // A card bill payment is the largest row of most months and none of the spending.
    const top = selectTopTransactions(
      [
        {
          id: "payment",
          amount: 20_000,
          type: "TRANSFER",
          description: "BPI card payment",
          date: new Date("2026-08-05T02:00:00.000Z"),
          category: { name: "Transfer", color: "#000", icon: "ArrowLeftRight" },
        },
        {
          id: "ride",
          amount: 255,
          type: "EXPENSE",
          description: "GSM Green ride",
          date: new Date("2026-07-15T02:00:00.000Z"),
          category: { name: "Transportation", color: "#000", icon: "Car" },
        },
      ],
      0,
      false
    );

    expect(top.map((t) => t.id)).toEqual(["ride"]);
  });
});
