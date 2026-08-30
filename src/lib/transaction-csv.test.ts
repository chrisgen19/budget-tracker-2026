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
          createdVia: "APP",
          receiptGroupId: null,
          category: { name: 'Food, "Dining"' },
          labels: [{ label: { name: "Work" } }],
          bill: null,
        },
      ],
      -480,
    );

    expect(csv).toBe(
      [
        "Date,Time,Description,Category,Labels,Type,Amount,Source,Receipt,Bill",
        '8/28/2026,8:30 AM,"Lunch at ""Cafe""","Food, ""Dining""","Work",EXPENSE,-42.5,APP,No,""',
      ].join("\n"),
    );
  });

  it("neutralizes spreadsheet formulas in user-controlled cells", () => {
    const csv = generateTransactionsCsv(
      [
        {
          amount: 1,
          date: new Date("2026-08-28T00:00:00.000Z"),
          description: "=HYPERLINK(\"https://bad.example\")",
          type: "INCOME",
          createdVia: "APP",
          receiptGroupId: null,
          category: { name: "+Injected" },
          labels: [{ label: { name: "@command" } }],
          bill: null,
        },
      ],
      0,
    );

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://bad.example\"\")\"");
    expect(csv).toContain("\"'+Injected\"");
    expect(csv).toContain("\"'@command\"");
  });
});
