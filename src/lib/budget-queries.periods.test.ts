import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { searchTransactions, getBudgetOverview, describePeriod } from "./budget-queries";

/** Asia/Manila. `getTimezoneOffset()` returns -480 for UTC+8, matching users.timezone_offset. */
const MANILA = -480;

/**
 * A real row from a Manila user's week: 06:00 on 26 August, stored as the previous UTC day.
 * Slicing its ISO string reports the 25th for a transaction the app shows on the 26th.
 */
const LATE_EVENING_UTC = new Date("2026-08-25T22:00:00.000Z");

type DateFilter = { gte?: Date; lte?: Date };

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "t1",
  amount: 38,
  description: "UV Express & Jeep fare",
  type: "EXPENSE",
  date: LATE_EVENING_UTC,
  receiptGroupId: null,
  category: { name: "Transportation", icon: "Car", color: "#5B8DEF" },
  labels: [],
  ...overrides,
});

const fakePrisma = (
  rows: Array<ReturnType<typeof row>> = [],
  groups: { byType?: unknown[]; byCategory?: unknown[]; names?: unknown[] } = {}
) => {
  const seen: Array<Record<string, unknown>> = [];
  const prisma = {
    transaction: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        seen.push(where);
        return rows;
      }),
      count: vi.fn(async () => rows.length),
      aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
      groupBy: vi.fn(async ({ by }: { by: string[] }) =>
        by[0] === "type" ? (groups.byType ?? []) : (groups.byCategory ?? [])
      ),
    },
    category: { findMany: vi.fn(async () => groups.names ?? []) },
  } as unknown as PrismaClient;
  return { prisma, seen };
};

const dateRange = (where: Record<string, unknown>) => where.date as DateFilter;

describe("explicit from/to ranges", () => {
  it("covers the whole of the `to` day rather than stopping at its first instant", async () => {
    const { prisma, seen } = fakePrisma();

    await searchTransactions(prisma, "u1", {
      from: "2026-08-24",
      to: "2026-08-29",
      timezoneOffset: MANILA,
    });

    // Manila midnight on the 24th, and the last millisecond of the 29th.
    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-08-23T16:00:00.000Z");
    expect(dateRange(seen[0]).lte?.toISOString()).toBe("2026-08-29T15:59:59.999Z");
  });

  it("includes a transaction made late on the last local day of the range", async () => {
    const { prisma, seen } = fakePrisma();

    // 2026-08-25T22:00Z is 06:00 on the 26th in Manila. Ending the range on the 26th must
    // therefore cover it -- and it only does if `to` resolves to the *end* of that local day.
    // Asserting only the exclusion case (a range ending on the 25th) would pass either way,
    // since a start-of-day bound excludes the row too, for the wrong reason.
    await searchTransactions(prisma, "u1", {
      from: "2026-08-24",
      to: "2026-08-26",
      timezoneOffset: MANILA,
    });

    const inclusive = dateRange(seen[0]);
    expect(LATE_EVENING_UTC <= inclusive.lte!).toBe(true);
    expect(LATE_EVENING_UTC >= inclusive.gte!).toBe(true);
  });

  it("excludes it from a range ending the local day before", async () => {
    const { prisma, seen } = fakePrisma();

    await searchTransactions(prisma, "u1", {
      from: "2026-08-24",
      to: "2026-08-25",
      timezoneOffset: MANILA,
    });

    expect(LATE_EVENING_UTC <= dateRange(seen[0]).lte!).toBe(false);
  });

  it("leaves the far end genuinely absent when only `from` is given", async () => {
    const { prisma, seen } = fakePrisma();

    await searchTransactions(prisma, "u1", { from: "2026-08-24", timezoneOffset: MANILA });

    // Not a sentinel instant: a `lte` of the maximum Date is a bound Postgres still has to
    // compare against, and the mirrored `gte: new Date(0)` would drop pre-1970 rows outright.
    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-08-23T16:00:00.000Z");
    expect("lte" in dateRange(seen[0])).toBe(false);
  });

  it("leaves the near end absent when only `to` is given, and does not call it backwards", async () => {
    const { prisma, seen } = fakePrisma();

    // With no `from`, there is nothing for `to` to be earlier than. Comparing against an epoch
    // sentinel rejected this outright while naming a `from` the caller never sent.
    await searchTransactions(prisma, "u1", { to: "1969-12-31", timezoneOffset: MANILA });

    expect("gte" in dateRange(seen[0])).toBe(false);
    expect(dateRange(seen[0]).lte?.toISOString()).toBe("1969-12-31T15:59:59.999Z");
  });

  it("applies no date filter at all when no period is given", async () => {
    const { prisma, seen } = fakePrisma();

    await searchTransactions(prisma, "u1", { timezoneOffset: MANILA });

    expect(seen[0].date).toBeUndefined();
  });

  it("refuses `month` together with `from`/`to` instead of silently picking one", async () => {
    const { prisma } = fakePrisma();

    await expect(
      searchTransactions(prisma, "u1", { month: "2026-08", from: "2026-08-24" })
    ).rejects.toThrow(/not both/);
  });

  it("rejects a day that does not exist rather than rolling it forward", async () => {
    const { prisma } = fakePrisma();

    // Date.UTC(2026, 1, 31) is 3 March, so without the round-trip check this would quietly
    // query a window nobody asked for.
    await expect(
      searchTransactions(prisma, "u1", { from: "2026-02-31" })
    ).rejects.toThrow(/not a real date/);
  });

  it("rejects a backwards range", async () => {
    const { prisma } = fakePrisma();

    await expect(
      searchTransactions(prisma, "u1", { from: "2026-08-29", to: "2026-08-24" })
    ).rejects.toThrow(/is after/);
  });
});

describe("the period a query ran over is reported back", () => {
  it("reports an explicit range as given, with no month", async () => {
    const { prisma } = fakePrisma();

    const result = await searchTransactions(prisma, "u1", {
      from: "2026-08-24",
      to: "2026-08-29",
      timezoneOffset: MANILA,
    });

    expect(result.period).toEqual({ month: null, from: "2026-08-24", to: "2026-08-29" });
  });

  it("expands a month into its first and last local day", () => {
    expect(describePeriod({ month: "2026-02" }, MANILA)).toEqual({
      month: "2026-02",
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("is null when nothing was filtered on", async () => {
    const { prisma } = fakePrisma();

    const result = await searchTransactions(prisma, "u1", {});

    expect(result.period).toBeNull();
  });
});

describe("rows carry the user's own calendar day", () => {
  it("reports the local day, not a slice of the UTC instant", async () => {
    const { prisma } = fakePrisma([row()]);

    const result = await searchTransactions(prisma, "u1", { timezoneOffset: MANILA });

    expect(result.transactions[0].date).toBe("2026-08-25T22:00:00.000Z");
    expect(result.transactions[0].localDate).toBe("2026-08-26");
  });

  it("exposes the receipt group, so rows of one split receipt are not read as separate shops", async () => {
    const { prisma } = fakePrisma([row({ receiptGroupId: "grp-1" })]);

    const result = await searchTransactions(prisma, "u1", { timezoneOffset: MANILA });

    expect(result.transactions[0].receiptGroupId).toBe("grp-1");
  });
});

describe("aggregates and payload size", () => {
  it("totals every match rather than the page it returned", async () => {
    const { prisma } = fakePrisma([], {
      byType: [
        { type: "EXPENSE", _sum: { amount: 11120 } },
        { type: "INCOME", _sum: { amount: 500 } },
      ],
      byCategory: [{ categoryId: "c1", _sum: { amount: 7608.65 }, _count: { _all: 10 } }],
      names: [{ id: "c1", name: "Food & Dining" }],
    });

    const result = await searchTransactions(prisma, "u1", {});

    expect(result.totals.expenses).toBe(11120);
    expect(result.totals.net).toBe(500 - 11120);
    // Named from the category table, not from the (empty) page.
    expect(result.totals.byCategory[0]).toEqual({
      categoryId: "c1",
      categoryName: "Food & Dining",
      amount: 7608.65,
      count: 10,
    });
  });

  it("omits the UI-only fields entirely under `compact`, rather than sending them as undefined", async () => {
    const { prisma } = fakePrisma([row()]);

    const result = await searchTransactions(prisma, "u1", { compact: true });
    const [only] = result.transactions;

    expect("categoryIcon" in only).toBe(false);
    expect("categoryColor" in only).toBe(false);
    expect(only.categoryName).toBe("Transportation");
  });

  it("keeps them by default", async () => {
    const { prisma } = fakePrisma([row()]);

    const result = await searchTransactions(prisma, "u1", {});

    expect(result.transactions[0].categoryIcon).toBe("Car");
  });
});

describe("get_budget_overview anchors relative dates", () => {
  it("reports today in the user's timezone, not the server's", async () => {
    vi.useFakeTimers();
    // 22:00 UTC on the 25th is already 06:00 on the 26th in Manila.
    vi.setSystemTime(LATE_EVENING_UTC);

    const { prisma } = fakePrisma();
    const result = await getBudgetOverview(prisma, "u1", { timezoneOffset: MANILA });

    expect(result.today).toBe("2026-08-26");
    expect(result.timezoneOffset).toBe(MANILA);
    vi.useRealTimers();
  });

  it("reports a null month and the real window when given a range", async () => {
    const { prisma } = fakePrisma();

    const result = await getBudgetOverview(prisma, "u1", {
      from: "2026-08-24",
      to: "2026-08-29",
      timezoneOffset: MANILA,
    });

    expect(result.month).toBeNull();
    expect(result.period).toEqual({ month: null, from: "2026-08-24", to: "2026-08-29" });
  });
});
