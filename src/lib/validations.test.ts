import { describe, it, expect } from "vitest";
import {
  batchTransactionSchema,
  createMcpTokenSchema,
  formatLocalDate,
  hasTrustworthyTime,
  isRealDate,
  mcpTransactionSchema,
  receiptBreakdownItemSchema,
  receiptBreakdownMetaSchema,
  resolveTransactionDate,
} from "./validations";
import { MAX_BREAKDOWN_LINE_ITEMS } from "./receipt-limits";

/** What the multi-scan flow actually posts (use-multi-scan.ts). */
const validBlob = {
  total: 172,
  items: [
    { name: "Cheers Starch-Bsd Plate 9''6s", amount: 72 },
    { name: "Ecobag Large MH", amount: 10 },
  ],
};

const batchRow = (receiptBreakdown: unknown) => ({
  amount: 172,
  description: "Lawson",
  type: "EXPENSE" as const,
  date: "2026-03-05",
  categoryId: "c1",
  receiptBreakdown,
});

describe("receiptBreakdownMetaSchema", () => {
  it("accepts the shape the scan flow produces", () => {
    expect(receiptBreakdownMetaSchema.safeParse(validBlob).success).toBe(true);
  });

  // Before this schema the column was z.any(), so each of these could be persisted and
  // would then reach ReceiptBreakdown, which reads breakdown.items.length with no guard.
  const rejected: Array<[string, unknown]> = [
    ["a string", "not an object"],
    ["null", null],
    ["missing items", { total: 10 }],
    ["items not an array", { total: 10, items: "nope" }],
    ["an empty item list", { total: 10, items: [] }],
    ["an item without a name", { total: 10, items: [{ amount: 5 }] }],
    ["an item without an amount", { total: 10, items: [{ name: "x" }] }],
    ["a non-numeric amount", { total: 10, items: [{ name: "x", amount: "5" }] }],
    ["a missing total", { items: [{ name: "x", amount: 5 }] }],
    ["a non-numeric total", { total: "10", items: [{ name: "x", amount: 5 }] }],
  ];

  for (const [label, blob] of rejected) {
    it(`rejects ${label}`, () => {
      expect(receiptBreakdownMetaSchema.safeParse(blob).success).toBe(false);
    });
  }

  it("bounds the item count, so one row cannot carry an unbounded blob", () => {
    const many = (n: number) => ({
      total: n,
      items: Array.from({ length: n }, (_, i) => ({ name: `i${i}`, amount: 1 })),
    });

    expect(receiptBreakdownMetaSchema.safeParse(many(MAX_BREAKDOWN_LINE_ITEMS)).success).toBe(true);
    expect(receiptBreakdownMetaSchema.safeParse(many(MAX_BREAKDOWN_LINE_ITEMS + 1)).success).toBe(
      false
    );
  });

  it("bounds the item name length", () => {
    const long = { total: 1, items: [{ name: "x".repeat(256), amount: 1 }] };
    expect(receiptBreakdownMetaSchema.safeParse(long).success).toBe(false);
  });

  it("rejects unknown keys rather than storing arbitrary payload in the JSON column", () => {
    const smuggled = { ...validBlob, extra: { anything: "at all" } };
    expect(receiptBreakdownMetaSchema.safeParse(smuggled).success).toBe(false);
  });
});

describe("batchTransactionSchema no longer accepts any receiptBreakdown", () => {
  it("accepts a well-formed one", () => {
    expect(batchTransactionSchema.safeParse(batchRow(validBlob)).success).toBe(true);
  });

  it("still allows the field to be absent", () => {
    expect(batchTransactionSchema.safeParse(batchRow(undefined)).success).toBe(true);
  });

  it("rejects a malformed one instead of persisting it", () => {
    expect(batchTransactionSchema.safeParse(batchRow({ items: "nope" })).success).toBe(false);
  });
});

describe("createMcpTokenSchema", () => {
  const base = { name: "laptop", expiresInDays: 90 };

  it("allows a read-only token that never expires", () => {
    // A credential that can only disclose is a contained risk, so an unbounded lifetime is a
    // reasonable choice to offer.
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["budget:read"],
      expiresInDays: null,
    });
    expect(result.success).toBe(true);
  });

  it("refuses a write token that never expires", () => {
    // Revocation only helps once the leak is noticed, so a writing credential has to age out.
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["transactions:write"],
      expiresInDays: null,
    });
    expect(result.success).toBe(false);
  });

  it("refuses a write token that outlives the write cap", () => {
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["budget:read", "transactions:write"],
      expiresInDays: 365,
    });
    expect(result.success).toBe(false);
  });

  it("allows a write token at exactly the cap", () => {
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["transactions:write"],
      expiresInDays: 90,
    });
    expect(result.success).toBe(true);
  });

  it("allows a read-only token to use the longer cap", () => {
    const result = createMcpTokenSchema.safeParse({
      ...base,
      scopes: ["budget:read"],
      expiresInDays: 365,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown scope", () => {
    const result = createMcpTokenSchema.safeParse({ ...base, scopes: ["transactions:destroy"] });
    expect(result.success).toBe(false);
  });
});

describe("isRealDate", () => {
  it("accepts a real calendar date", () => {
    expect(isRealDate("2026-08-25")).toBe(true);
  });

  it("rejects a day that does not exist in that month", () => {
    // Date.parse alone returns a finite value here: JS rolls 31 February forward to 3 March, so
    // the row would be stored on a different day from the one the user approved.
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-04-31")).toBe(false);
  });

  it("rejects an impossible month", () => {
    expect(isRealDate("2026-13-01")).toBe(false);
  });

  it("rejects nonsense", () => {
    expect(isRealDate("not-a-date")).toBe(false);
  });

  it("accepts a full timestamp", () => {
    expect(isRealDate("2026-08-25T14:30:00.000Z")).toBe(true);
    expect(isRealDate("2026-08-25T14:30")).toBe(true);
    expect(isRealDate("2026-08-25T14:30:00+08:00")).toBe(true);
  });

  it("rejects an impossible day even when it carries a time", () => {
    // The date-only check alone was trivially bypassed by appending a time: Date.parse accepts
    // this and rolls it forward to 3 March, so the row would be stored on a different day.
    expect(isRealDate("2026-02-31T00:00:00Z")).toBe(false);
    expect(isRealDate("2026-04-31T12:00:00Z")).toBe(false);
  });

  it("rejects out-of-range time components", () => {
    expect(isRealDate("2026-08-25T24:00:00Z")).toBe(false);
    expect(isRealDate("2026-08-25T12:60:00Z")).toBe(false);
    expect(isRealDate("2026-08-25T12:00:61Z")).toBe(false);
  });

  it("rejects a timestamp whose offset cannot exist", () => {
    // The anchored pattern admits the shape, but no such instant exists. Checked with a parse
    // backstop rather than another per-component rule, because narrower checks had already let
    // two separate cases through.
    expect(isRealDate("2026-08-25T12:00+24:00")).toBe(false);
    expect(isRealDate("2026-08-25T12:00+14:61")).toBe(false);
    expect(isRealDate("2026-08-25T12:00+99:99")).toBe(false);
  });

  it("still accepts a real offset", () => {
    expect(isRealDate("2026-08-25T12:00+08:00")).toBe(true);
    expect(isRealDate("2026-08-25T12:00-05:00")).toBe(true);
  });

  it("accepts nothing that new Date() cannot represent", () => {
    // The property that matters: anything this admits must produce a usable instant, or the
    // write fails inside Prisma and is reported as UNKNOWN_WHETHER_SAVED, which tells the caller
    // to retry a request that can never succeed.
    const candidates = [
      "2026-08-25",
      "2026-08-25T12:00",
      "2026-08-25T12:00:00Z",
      "2026-08-25T12:00+24:00",
      "2026-02-31",
      "2026-13-01",
      "0",
      "2026",
      "Mar 3 2026",
      "",
    ];
    for (const value of candidates) {
      if (isRealDate(value)) {
        expect(Number.isNaN(new Date(value).getTime())).toBe(false);
      }
    }
  });

  it("rejects loose strings that Date.parse happens to accept", () => {
    // Each of these parses to some real instant bearing no relation to what a user approved:
    // "0" is 1999-12-31 in a UTC+8 environment, "2026" is 1 January, and the last is a US
    // locale format the tool never documents.
    expect(isRealDate("0")).toBe(false);
    expect(isRealDate("2026")).toBe(false);
    expect(isRealDate("2026-08")).toBe(false);
    expect(isRealDate("Mar 3 2026")).toBe(false);
  });
});

describe("formatLocalDate", () => {
  it("reports the user's calendar day, not the UTC one", () => {
    // A UTC+8 user's 1 March row is stored as 2026-02-28T16:00Z. Slicing the ISO string would
    // echo 28 February back to the model for a transaction the app shows on the 1st.
    const stored = new Date("2026-02-28T16:00:00.000Z");
    expect(formatLocalDate(stored, -480)).toBe("2026-03-01");
    expect(stored.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("works west of Greenwich too", () => {
    // UTC-5: local midnight on 1 March is 05:00Z the same day.
    expect(formatLocalDate(new Date("2026-03-01T05:00:00.000Z"), 300)).toBe("2026-03-01");
  });

  it("round-trips with resolveTransactionDate", () => {
    for (const offset of [-480, 0, 300, -60]) {
      const stored = new Date(resolveTransactionDate("2026-03-01", offset));
      expect(formatLocalDate(stored, offset)).toBe("2026-03-01");
    }
  });
});

describe("resolveTransactionDate", () => {
  // Fixed "now" so the bare-date cases are deterministic: 14:30 UTC, which is 22:30 at UTC+8
  // and 09:30 at UTC-5.
  const NOW = new Date("2026-03-01T14:30:00.000Z");

  it("fills a bare date with the user's current clock, not midnight", () => {
    // Midnight was a tell: every MCP row sat at 12:00 AM while not one app-created row did. The
    // form and the receipt scanner both attach the current wall clock, so this matches them.
    // UTC+8: 22:30 local on 1 March is 14:30 UTC the same day.
    expect(resolveTransactionDate("2026-03-01", -480, NOW)).toBe("2026-03-01T14:30:00.000Z");
  });

  it("keeps a bare date on the day the user named, whatever the offset", () => {
    // The property that matters: filling in a clock must not move the row to another day.
    for (const offset of [-720, -480, 0, 300, 660]) {
      const stored = new Date(resolveTransactionDate("2026-03-01", offset, NOW));
      expect(formatLocalDate(stored, offset)).toBe("2026-03-01");
    }
  });

  it("still resolves an explicit local midnight correctly", () => {
    // Midnight is no longer the default, but it must remain expressible.
    expect(resolveTransactionDate("2026-03-01T00:00", 300, NOW)).toBe("2026-03-01T05:00:00.000Z");
    expect(resolveTransactionDate("2026-03-01T00:00", -480, NOW)).toBe("2026-02-28T16:00:00.000Z");
  });

  it("preserves a time the user actually gave", () => {
    // The case that prompted this: "last night" must survive as an evening, not become 12:00 AM.
    expect(resolveTransactionDate("2026-08-25T21:00", -480, NOW)).toBe("2026-08-25T13:00:00.000Z");
  });

  it("leaves a value that already pins its instant alone", () => {
    // An explicit Z or offset is the caller's decision; nothing to resolve.
    const exact = "2026-03-01T09:15:00.000Z";
    expect(resolveTransactionDate(exact, 300)).toBe(exact);
    expect(resolveTransactionDate("2026-03-01T09:15+05:00", -480)).toBe("2026-03-01T09:15+05:00");
  });

  it("resolves an offset-less time against the user, not the server", () => {
    // `new Date("2026-08-25T23:30")` uses the *server's* timezone, which is UTC in production, so
    // without this the stored instant would depend on where the app runs. For a UTC+8 user 23:30
    // local is 15:30Z the same day; interpreting it as UTC would push it to the 26th locally.
    expect(resolveTransactionDate("2026-08-25T23:30", -480)).toBe("2026-08-25T15:30:00.000Z");
    expect(resolveTransactionDate("2026-08-25T23:30", 300)).toBe("2026-08-26T04:30:00.000Z");
  });

  it("keeps the local calendar day for a late offset-less time", () => {
    // The property that actually matters: whatever the offset, the day the user typed is the day
    // the app shows back.
    for (const offset of [-480, 0, 300, -60, 720]) {
      const stored = new Date(resolveTransactionDate("2026-08-25T23:30", offset));
      expect(formatLocalDate(stored, offset)).toBe("2026-08-25");
    }
  });
});

describe("mcpTransactionSchema", () => {
  const base = {
    amount: 10,
    description: "x",
    type: "EXPENSE" as const,
    categoryId: "c1",
  };

  it("rejects an impossible date rather than silently rolling it forward", () => {
    expect(mcpTransactionSchema.safeParse({ ...base, date: "2026-02-31" }).success).toBe(false);
  });

  it("rejects an impossible date carrying a time", () => {
    expect(
      mcpTransactionSchema.safeParse({ ...base, date: "2026-02-31T00:00:00Z" }).success
    ).toBe(false);
  });

  it("accepts a real date", () => {
    expect(mcpTransactionSchema.safeParse({ ...base, date: "2026-08-25" }).success).toBe(true);
  });
});

describe("hasTrustworthyTime", () => {
  // 2026-08-26T00:09Z is 08:09 on the 26th at UTC+8, and 19:09 on the 25th at UTC-5.
  const NOW = new Date("2026-08-26T00:09:00.000Z");
  const MANILA = -480;
  const NEW_YORK = 300;

  it("trusts a time the caller supplied", () => {
    expect(hasTrustworthyTime("2026-08-20T21:00", MANILA, NOW)).toBe(true);
    expect(hasTrustworthyTime("2026-08-20T21:00:00Z", MANILA, NOW)).toBe(true);
  });

  it("trusts a bare date that is today for the user", () => {
    // Filling today with the current clock is what the app's own form does anyway.
    expect(hasTrustworthyTime("2026-08-26", MANILA, NOW)).toBe(true);
  });

  it("does not trust a bare date in the past", () => {
    // The clock would be fabricated: yesterday's dinner stamped with this morning's time, which
    // then falls inside a weekday 05:00-17:00 window and tags a dinner as work spending.
    expect(hasTrustworthyTime("2026-08-25", MANILA, NOW)).toBe(false);
    expect(hasTrustworthyTime("2026-01-01", MANILA, NOW)).toBe(false);
  });

  it("does not trust a bare date in the future", () => {
    expect(hasTrustworthyTime("2026-08-27", MANILA, NOW)).toBe(false);
  });

  it("decides today against the user's timezone, not the server's", () => {
    // The same instant is the 26th in Manila and still the 25th in New York, so the same bare
    // date is trustworthy for one user and not the other.
    expect(hasTrustworthyTime("2026-08-26", MANILA, NOW)).toBe(true);
    expect(hasTrustworthyTime("2026-08-26", NEW_YORK, NOW)).toBe(false);
    expect(hasTrustworthyTime("2026-08-25", NEW_YORK, NOW)).toBe(true);
  });

  it("does not trust a value it cannot parse", () => {
    expect(hasTrustworthyTime("not-a-date", MANILA, NOW)).toBe(false);
  });
});

describe("receiptBreakdownItemSchema", () => {
  // The bound was 50 on both schemas and was raised because a real supermarket receipt carries
  // more. They have to move together: the scan-side schema decides what a scan may return and
  // the storage-side one decides what may be saved, so a bound raised on one alone produces a
  // receipt that scans cleanly and is then rejected on save.
  it("shares one bound with the scan-side schema, so the two cannot drift apart", () => {
    const lineItems = Array.from({ length: MAX_BREAKDOWN_LINE_ITEMS }, (_, i) => ({
      name: `i${i}`,
      amount: 1,
    }));

    expect(
      receiptBreakdownItemSchema.safeParse({
        amount: 100,
        categoryId: "c1",
        description: "Groceries",
        lineItems,
      }).success
    ).toBe(true);

    expect(
      receiptBreakdownItemSchema.safeParse({
        amount: 100,
        categoryId: "c1",
        description: "Groceries",
        lineItems: [...lineItems, { name: "one too many", amount: 1 }],
      }).success
    ).toBe(false);
  });
});
