import { describe, expect, it } from "vitest";
import { formatTime, groupByDate } from "@/lib/transaction-helpers";
import type { TransactionWithCategory } from "@/types";

const transaction = (id: string, date: string, amount: number): TransactionWithCategory =>
  ({
    id,
    date,
    amount,
    description: id,
    type: "EXPENSE",
    categoryId: "category",
    userId: "user",
    category: { name: "Food" },
  }) as unknown as TransactionWithCategory;

describe("transaction display time", () => {
  it("groups and formats using the account offset", () => {
    const rows = [
      transaction("late", "2026-08-27T16:30:00.000Z", 10),
      transaction("early", "2026-08-28T00:30:00.000Z", 5),
    ];

    const manila = groupByDate(rows, -480);
    expect(manila).toHaveLength(1);
    expect(manila[0]).toMatchObject({
      dateKey: "2026-08-28",
      dateLabel: "August 28, 2026",
      dayNameShort: "Fri",
      subtotal: -15,
    });
    expect(formatTime(rows[1].date, -480)).toBe("8:30 AM");

    const losAngeles = groupByDate(rows, 420);
    expect(losAngeles.map((group) => group.dateKey)).toEqual([
      "2026-08-27",
      "2026-08-27",
    ].filter((key, index, all) => all.indexOf(key) === index));
    expect(formatTime(rows[1].date, 420)).toBe("5:30 PM");
  });
});
