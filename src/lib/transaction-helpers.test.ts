import { describe, expect, it } from "vitest";
import { formatFilterRangeLabel, formatTime, groupByDate } from "@/lib/transaction-helpers";
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

describe("formatFilterRangeLabel", () => {
  it("prints one day as a single date", () => {
    expect(formatFilterRangeLabel("2026-09-12", "2026-09-12")).toBe("Sep 12, 2026");
  });

  it("prints the year once when both ends share it", () => {
    expect(formatFilterRangeLabel("2026-01-15", "2026-03-03")).toBe("Jan 15 – Mar 3, 2026");
  });

  it("prints the year on both ends across New Year", () => {
    expect(formatFilterRangeLabel("2025-12-28", "2026-01-03")).toBe("Dec 28, 2025 – Jan 3, 2026");
  });

  it("labels an open end", () => {
    expect(formatFilterRangeLabel("2026-09-01", null)).toBe("From Sep 1, 2026");
    expect(formatFilterRangeLabel(null, "2026-09-30")).toBe("Until Sep 30, 2026");
    expect(formatFilterRangeLabel(null, null)).toBe("");
  });

  it("reads the day as written rather than shifting it into the local zone", () => {
    // "2026-01-01" parsed as a local instant lands on Dec 31 west of UTC.
    expect(formatFilterRangeLabel("2026-01-01", "2026-01-01")).toBe("Jan 1, 2026");
  });
});
