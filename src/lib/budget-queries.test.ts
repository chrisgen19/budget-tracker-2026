import { describe, it, expect, vi, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getSpendingByCategory,
  getTopExpenses,
  getMonthlySummary,
  getBudgetOverview,
  searchTransactions,
} from "./budget-queries";

/** Asia/Manila. `getTimezoneOffset()` returns -480 for UTC+8, matching users.timezone_offset. */
const MANILA = -480;

/**
 * The live case this suite exists for: 2026-02-28T23:45Z is 2026-03-01T07:45 in Manila,
 * so it belongs to March for a Manila user and to February in UTC.
 */
const BOUNDARY_TX = new Date("2026-02-28T23:45:00.000Z");

type DateFilter = { gte?: Date; lte?: Date; lt?: Date };

/** Captures the `where` Prisma would have been called with, so the date range can be asserted. */
const captureWhere = () => {
  const seen: Array<Record<string, unknown>> = [];
  const prisma = {
    transaction: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        seen.push(where);
        return [];
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        seen.push(where);
        return 0;
      }),
      aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
    },
  } as unknown as PrismaClient;
  return { prisma, seen };
};

const dateRange = (where: Record<string, unknown>) => where.date as DateFilter;

afterEach(() => {
  vi.useRealTimers();
});

describe("month boundaries respect the user's timezone", () => {
  it("starts a Manila month 8 hours before the UTC month", async () => {
    const { prisma, seen } = captureWhere();

    await getSpendingByCategory(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    const { gte, lte } = dateRange(seen[0]);
    expect(gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
    expect(lte?.toISOString()).toBe("2026-03-31T15:59:59.999Z");
  });

  it("puts the boundary transaction in March for Manila and not February", async () => {
    const { prisma, seen } = captureWhere();

    await getSpendingByCategory(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });
    const march = dateRange(seen[0]);
    expect(BOUNDARY_TX >= march.gte!).toBe(true);
    expect(BOUNDARY_TX <= march.lte!).toBe(true);

    await getSpendingByCategory(prisma, "u1", { month: "2026-02", timezoneOffset: MANILA });
    const february = dateRange(seen[1]);
    expect(BOUNDARY_TX <= february.lte!).toBe(false);
  });

  it("still puts it in February when no offset is given (UTC fallback)", async () => {
    const { prisma, seen } = captureWhere();

    await getSpendingByCategory(prisma, "u1", { month: "2026-02" });

    const { gte, lte } = dateRange(seen[0]);
    expect(gte?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(BOUNDARY_TX >= gte!).toBe(true);
    expect(BOUNDARY_TX <= lte!).toBe(true);
  });

  it("applies the offset in getTopExpenses", async () => {
    const { prisma, seen } = captureWhere();

    await getTopExpenses(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });

  it("applies the offset in searchTransactions", async () => {
    const { prisma, seen } = captureWhere();

    await searchTransactions(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });

  it("applies the offset in getBudgetOverview", async () => {
    const { prisma, seen } = captureWhere();

    await getBudgetOverview(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });
});

describe("the default month follows the user's local day, not the container's", () => {
  it("resolves to March for Manila when UTC is still in February", async () => {
    // 23:45Z on Feb 28 is already 07:45 on Mar 1 in Manila.
    vi.useFakeTimers();
    vi.setSystemTime(BOUNDARY_TX);

    const { prisma, seen } = captureWhere();
    await getBudgetOverview(prisma, "u1", { timezoneOffset: MANILA });

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });

  it("resolves to February for a UTC user at the same instant", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BOUNDARY_TX);

    const { prisma, seen } = captureWhere();
    await getBudgetOverview(prisma, "u1", {});

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("getMonthlySummary buckets by the user's local month", () => {
  const summaryPrisma = (rows: Array<{ amount: number; type: string; date: Date }>) =>
    ({
      transaction: { findMany: vi.fn(async () => rows) },
    }) as unknown as PrismaClient;

  it("counts the boundary transaction in March for Manila", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));

    const result = await getMonthlySummary(
      summaryPrisma([{ amount: 139, type: "EXPENSE", date: BOUNDARY_TX }]),
      "u1",
      { months: 2, timezoneOffset: MANILA }
    );

    expect(result.map((r) => r.month)).toEqual(["Feb 2026", "Mar 2026"]);
    expect(result[0].expenses).toBe(0);
    expect(result[1].expenses).toBe(139);
  });

  it("counts it in February for a UTC user", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));

    const result = await getMonthlySummary(
      summaryPrisma([{ amount: 139, type: "EXPENSE", date: BOUNDARY_TX }]),
      "u1",
      { months: 2 }
    );

    expect(result[0].expenses).toBe(139);
    expect(result[1].expenses).toBe(0);
  });
});
