import { describe, it, expect, vi, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getSpendingByCategory,
  getTopExpenses,
  getMonthlySummary,
  getBudgetOverview,
  searchTransactions,
  getLabelBreakdown,
  getLabelList,
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

describe("getLabelBreakdown mirrors the analytics page's arithmetic", () => {
  type Tx = { amount: number; labels: Array<{ labelId: string; label: { name: string; color: string } }> };

  const labelPrisma = (rows: Tx[]) =>
    ({ transaction: { findMany: vi.fn(async () => rows) } }) as unknown as PrismaClient;

  const lbl = (id: string) => ({ labelId: id, label: { name: id, color: "#000" } });

  it("splits a transaction's amount evenly across its labels", async () => {
    // One 1000 expense tagged twice contributes 500 to each, so the labels still sum to 1000.
    const result = await getLabelBreakdown(
      labelPrisma([{ amount: 1000, labels: [lbl("work"), lbl("travel")] }]),
      "u1",
      { month: "2026-03" }
    );

    expect(result.total).toBe(1000);
    expect(result.labels.map((l) => [l.name, l.amount])).toEqual([
      ["work", 500],
      ["travel", 500],
    ]);
    expect(result.labels.reduce((s, l) => s + l.amount, 0)).toBe(1000);
  });

  it("counts a transaction once per label, so counts do not sum to the transaction total", async () => {
    const result = await getLabelBreakdown(
      labelPrisma([{ amount: 1000, labels: [lbl("work"), lbl("travel")] }]),
      "u1",
      { month: "2026-03" }
    );

    expect(result.labels.map((l) => l.transactionCount)).toEqual([1, 1]);
  });

  it("buckets untagged transactions under 'unlabeled' rather than dropping them", async () => {
    const result = await getLabelBreakdown(
      labelPrisma([
        { amount: 300, labels: [lbl("work")] },
        { amount: 700, labels: [] },
      ]),
      "u1",
      { month: "2026-03" }
    );

    const unlabeled = result.labels.find((l) => l.id === "unlabeled");
    expect(unlabeled).toBeDefined();
    expect(unlabeled!.amount).toBe(700);
    expect(unlabeled!.transactionCount).toBe(1);
    expect(result.labels.reduce((s, l) => s + l.amount, 0)).toBe(1000);
  });

  it("takes percentages against the period total including unlabeled", async () => {
    const result = await getLabelBreakdown(
      labelPrisma([
        { amount: 250, labels: [lbl("work")] },
        { amount: 750, labels: [] },
      ]),
      "u1",
      { month: "2026-03" }
    );

    expect(result.labels.find((l) => l.name === "work")!.percentage).toBe(25);
    expect(result.labels.find((l) => l.id === "unlabeled")!.percentage).toBe(75);
  });

  it("sorts by amount descending and omits 'unlabeled' when everything is tagged", async () => {
    const result = await getLabelBreakdown(
      labelPrisma([
        { amount: 100, labels: [lbl("small")] },
        { amount: 900, labels: [lbl("big")] },
      ]),
      "u1",
      { month: "2026-03" }
    );

    expect(result.labels.map((l) => l.name)).toEqual(["big", "small"]);
    expect(result.labels.some((l) => l.id === "unlabeled")).toBe(false);
  });

  it("reports zero percentages instead of dividing by zero on an empty month", async () => {
    const result = await getLabelBreakdown(labelPrisma([]), "u1", { month: "2026-03" });

    expect(result.total).toBe(0);
    expect(result.labels).toEqual([]);
  });

  it("defaults to EXPENSE and queries the month in the user's timezone", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = {
      transaction: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return [];
        }),
      },
    } as unknown as PrismaClient;

    await getLabelBreakdown(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    expect(seen[0].type).toBe("EXPENSE");
    expect((seen[0].date as DateFilter).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });
});

describe("getLabelList", () => {
  const labelPrisma = () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = {
      label: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return [];
        }),
      },
    } as unknown as PrismaClient;
    return { prisma, seen };
  };

  it("treats BOTH labels as matching either type filter", async () => {
    const { prisma, seen } = labelPrisma();

    await getLabelList(prisma, "u1", { applicableTo: "INCOME" });

    expect(seen[0].applicableTo).toEqual({ in: ["INCOME", "BOTH"] });
  });

  it("does not filter when no type is given", async () => {
    const { prisma, seen } = labelPrisma();

    await getLabelList(prisma, "u1", {});

    expect(seen[0].applicableTo).toBeUndefined();
  });
});

describe("searchTransactions label filter", () => {
  const searchPrisma = () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = {
      transaction: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return [];
        }),
        count: vi.fn(async () => 0),
      },
    } as unknown as PrismaClient;
    return { prisma, seen };
  };

  it("matches transactions carrying any of the given labels", async () => {
    const { prisma, seen } = searchPrisma();

    await searchTransactions(prisma, "u1", { labelIds: ["a", "b"] });

    expect(seen[0].labels).toEqual({ some: { labelId: { in: ["a", "b"] } } });
  });

  it("ignores an empty label list rather than matching nothing", async () => {
    const { prisma, seen } = searchPrisma();

    await searchTransactions(prisma, "u1", { labelIds: [] });

    expect(seen[0].labels).toBeUndefined();
  });
});
