import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  planFindFirst: vi.fn(),
  planFindMany: vi.fn(),
  transactionFindMany: vi.fn(),
  incomeFindFirst: vi.fn(),
  categoryFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetPlan: { findFirst: mocks.planFindFirst, findMany: mocks.planFindMany },
    transaction: { findMany: mocks.transactionFindMany },
    scheduledTransaction: { findFirst: mocks.incomeFindFirst },
    category: { findMany: mocks.categoryFindMany },
    $transaction: mocks.transaction,
  },
}));

import { getBudgetPerformance, saveBudgetPlan } from "@/lib/budget-plans";

const category = (id: string, type: "INCOME" | "EXPENSE") => ({
  id,
  name: id === "food" ? "Food" : "Salary",
  icon: "Wallet",
  color: "#123456",
  type,
});

const allocation = (id: string, type: "INCOME" | "EXPENSE", overrides = {}) => ({
  id: `allocation-${id}`,
  planId: "plan-1",
  categoryId: id,
  category: category(id, type),
  amount: type === "EXPENSE" ? 6_000 : 20_000,
  kind: type === "EXPENSE" ? "FLEXIBLE" : "INCOME",
  rolloverEnabled: type === "EXPENSE",
  rolloverCarryIn: type === "EXPENSE" ? 500 : 0,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

describe("getBudgetPerformance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T04:00:00Z"));
    vi.clearAllMocks();
    mocks.planFindFirst.mockResolvedValue({
      id: "plan-1",
      revision: 2,
      createdAt: new Date("2026-09-10T00:00:00Z"),
      allocations: [allocation("food", "EXPENSE"), allocation("salary", "INCOME")],
    });
    mocks.planFindMany.mockResolvedValue([
      { id: "plan-1", revision: 2, createdAt: new Date("2026-09-10T00:00:00Z") },
      { id: "plan-0", revision: 1, createdAt: new Date("2026-09-01T00:00:00Z") },
    ]);
    mocks.incomeFindFirst.mockResolvedValue({ nextDueDate: new Date("2026-09-20T00:00:00Z") });
    const rows = [
      { categoryId: "food", type: "EXPENSE", amount: 4_000, date: new Date("2026-09-10T04:00:00Z") },
      { categoryId: "other", type: "EXPENSE", amount: 500, date: new Date("2026-09-11T04:00:00Z") },
      { categoryId: "food", type: "EXPENSE", amount: 9_000, date: new Date("2026-09-20T04:00:00Z") },
    ];
    mocks.transactionFindMany.mockImplementation(async ({ where }: { where: { date: { gte: Date; lte: Date } } }) =>
      rows.filter((row) => row.date >= where.date.gte && row.date <= where.date.lte));
  });

  afterEach(() => vi.useRealTimers());

  it("clips actuals at local today and reconciles budgeted and unbudgeted spending", async () => {
    const result = await getBudgetPerformance("user-1", "2026-09", -480);

    expect(result.progress).toMatchObject({ daysElapsed: 15, daysInMonth: 30, effectiveTo: "2026-09-15" });
    expect(result.plan).toMatchObject({ revision: 2, revisionCount: 2 });
    expect(result.plan?.history.map((revision) => revision.revision)).toEqual([2, 1]);
    expect(result.allocations.find((row) => row.categoryId === "food")).toMatchObject({ actual: 4_000, projectedActual: 8_000 });
    expect(result.totals).toMatchObject({ actualExpenses: 4_500, unbudgetedExpenses: 500 });
    expect(result.safeToSpend).toMatchObject({ nextIncomeDate: "2026-09-20", daysUntilNextIncome: 5 });

    const query = mocks.transactionFindMany.mock.calls[0][0];
    expect(query.where.date.lte.toISOString()).toBe("2026-09-15T15:59:59.999Z");
  });
});

describe("saveBudgetPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.categoryFindMany.mockResolvedValue([{ id: "food", type: "EXPENSE" }]);
    mocks.planFindFirst.mockResolvedValue({
      allocations: [allocation("food", "EXPENSE", { amount: 6_000, rolloverCarryIn: 500 })],
    });
    mocks.transactionFindMany.mockResolvedValue([{ categoryId: "food", amount: 5_000 }]);
  });

  it("creates a new immutable revision with snapshotted signed carry-in", async () => {
    const create = vi.fn(async ({ data }: { data: { revision: number; allocations: { create: unknown[] } } }) => ({
      id: "plan-3",
      revision: data.revision,
      allocations: data.allocations.create,
    }));
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      budgetPlan: { findFirst: vi.fn().mockResolvedValue({ revision: 2 }), create },
    }));

    const result = await saveBudgetPlan("user-1", "2026-09", -480, {
      allocations: [{ categoryId: "food", amount: 7_000, kind: "FLEXIBLE", rolloverEnabled: true }],
    });

    expect(result.revision).toBe(3);
    expect(create.mock.calls[0][0].data.allocations.create[0]).toMatchObject({ rolloverCarryIn: 1_500 });
  });
});
