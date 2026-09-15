// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: mocks.findMany } },
}));

import { GET } from "@/app/api/analytics/route";

const MANILA = -480;

const transaction = (
  localDay: string,
  amount: number,
  type: "EXPENSE" | "INCOME" = "EXPENSE",
  category = { id: "food", name: "Food", color: "#000", icon: "Utensils" },
  labels: Array<{ labelId: string; label: { name: string; color: string } }> = [],
) => ({
  id: `${localDay}-${amount}-${type}`,
  amount,
  type,
  description: "Daily expense",
  categoryId: category.id,
  date: new Date(`${localDay}T04:00:00.000Z`),
  category,
  labels,
});

const localDay = (date: Date): string =>
  new Date(date.getTime() - MANILA * 60_000).toISOString().slice(0, 10);

describe("GET /api/analytics partial-period comparison", () => {
  const rows = [
    ...Array.from({ length: 9 }, (_, index) => transaction(`2026-09-${String(index + 1).padStart(2, "0")}`, 100)),
    ...Array.from({ length: 9 }, (_, index) => transaction(`2026-08-${String(index + 1).padStart(2, "0")}`, 50)),
    transaction("2026-09-20", 9_000),
    transaction("2026-08-20", 8_000),
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T04:00:00.000Z"));
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.findMany.mockImplementation(async ({ where }: {
      where: { date: { gte: Date; lte: Date } };
    }) => rows.filter((row) => row.date >= where.date.gte && row.date <= where.date.lte));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("clips both queries, daily averages and labels to matching elapsed windows", async () => {
    const response = await GET(new Request(
      `http://localhost/api/analytics?granularity=weekly&from=2026-09-01&to=2026-09-30&tz=${MANILA}&type=ALL`,
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.totalExpenses).toBe(900);
    expect(body.previousSummary.totalExpenses).toBe(450);
    expect(body.statistics.avgDailySpend).toBe(60);
    expect(body.statistics.totalDaysInPeriod).toBe(15);
    expect(body.daily).toHaveLength(15);
    expect(body.periodLabel).toBe("September 2026 so far");
    expect(body.previousPeriodLabel).toBe("Aug 1 – Aug 15, 2026");
    expect(body.periodContext).toMatchObject({
      isPartial: true,
      daysElapsed: 15,
      daysInPeriod: 30,
      comparisonStatus: "available",
      // 9 logged days of the 14 finished ones: today (the 15th) has nothing yet.
      currentCoveragePct: 64,
      previousCoveragePct: 60,
    });
    expect(body.cashFlowSignals.expenseChange).toBe(1);

    const queriedWindows = mocks.findMany.mock.calls.map(([args]) => [
      localDay(args.where.date.gte),
      localDay(args.where.date.lte),
    ]);
    expect(queriedWindows).toContainEqual(["2026-09-01", "2026-09-15"]);
    expect(queriedWindows).toContainEqual(["2026-08-01", "2026-08-15"]);
  });

  it("rejects an impossible timezone before querying", async () => {
    const response = await GET(new Request(
      "http://localhost/api/analytics?granularity=weekly&from=2026-09-01&to=2026-09-30&tz=900&type=ALL",
    ));

    expect(response.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects a range over the documented maximum before querying", async () => {
    const response = await GET(new Request(
      `http://localhost/api/analytics?granularity=yearly&from=2000-01-01&to=2011-01-01&tz=${MANILA}&type=ALL`,
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.to).toContain("Date range cannot exceed 3,660 days");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects an excessive bucket count before querying", async () => {
    const response = await GET(new Request(
      `http://localhost/api/analytics?granularity=weekly&from=2020-01-01&to=2025-01-01&tz=${MANILA}&type=ALL`,
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.granularity).toContain("Date range produces more than 260 weekly buckets");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("filters only category, label, and top-transaction breakdowns", async () => {
    const salary = { id: "salary", name: "Salary", color: "#0a0", icon: "Wallet" };
    const mixedRows = [
      transaction("2026-09-01", 100),
      transaction("2026-09-02", 1_000, "INCOME", salary, [
        { labelId: "payroll", label: { name: "Payroll", color: "#0a0" } },
      ]),
    ];
    mocks.findMany.mockImplementation(async ({ where }: {
      where: { date: { gte: Date; lte: Date } };
    }) => mixedRows.filter((row) => row.date >= where.date.gte && row.date <= where.date.lte));

    const response = await GET(new Request(
      `http://localhost/api/analytics?granularity=weekly&from=2026-09-01&to=2026-09-30&tz=${MANILA}&type=INCOME`,
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.categoryBreakdown.map((item: { type: string }) => item.type)).toEqual(["INCOME"]);
    expect(body.labelBreakdown.map((item: { name: string }) => item.name)).toEqual(["Payroll"]);
    expect(body.topTransactions.map((item: { type: string }) => item.type)).toEqual(["INCOME"]);

    expect(body.summary).toMatchObject({ totalIncome: 1_000, totalExpenses: 100, transactionCount: 2 });
    expect(body.cashFlow.reduce((sum: number, item: { expenses: number }) => sum + item.expenses, 0)).toBe(100);
    expect(body.daily.find((item: { date: string }) => item.date === "2026-09-01").expenses).toBe(100);
    expect(body.categoryTrends.series.map((item: { name: string }) => item.name)).toEqual(["Food"]);
  });
});
