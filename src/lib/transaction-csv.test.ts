import { describe, expect, it } from "vitest";
import { generateTransactionsCsv } from "@/lib/transaction-csv";

describe("generateTransactionsCsv", () => {
  it("exports date and time in the saved account timezone", () => {
    const csv = generateTransactionsCsv(
      [
        {
          amount: 42.5,
          date: new Date("2026-08-28T00:30:00.000Z"),
          description: 'Lunch at "Cafe"',
          type: "EXPENSE",
          category: { name: 'Food, "Dining"' },
        },
      ],
      -480,
    );

    expect(csv).toBe(
      [
        "Date,Time,Description,Category,Type,Amount",
        '8/28/2026,8:30 AM,"Lunch at ""Cafe""","Food, ""Dining""",EXPENSE,-42.5',
      ].join("\n"),
    );
  });
});
