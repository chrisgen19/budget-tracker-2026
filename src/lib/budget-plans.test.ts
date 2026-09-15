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
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

interface Row { categoryId: string; type: string; amount: number; date: Date }
interface TransactionQuery {
  where: { type?: string; categoryId?: { in: string[] }; date: { gte: Date; lte: Date } };
}
interface EarlierPlan { month: string; allocations: Array<{ categoryId: string; amount: number }> }

/** Noon in Manila on a local calendar day, so the row cannot straddle a UTC day boundary. */
const expense = (localDay: string, amount: number, categoryId = "food"): Row => ({
  categoryId,
  type: "EXPENSE",
  amount,
  date: new Date(`${localDay}T04:00:00.000Z`),
});

const serveTransactions = (rows: Row[]) => mocks.transactionFindMany.mockImplementation(
  async ({ where }: TransactionQuery) => rows.filter((row) => row.date >= where.date.gte
    && row.date <= where.date.lte
    && (!where.type || row.type === where.type)
    && (!where.categoryId || where.categoryId.in.includes(row.categoryId))),
);

const revisions = [
  { id: "plan-1", revision: 2, createdAt: new Date("2026-09-10T00:00:00Z") },
  { id: "plan-0", revision: 1, createdAt: new Date("2026-09-01T00:00:00Z") },
];

/** The carry-in read asks for earlier months (`month: { lt }`); the revision list asks for one. */
const servePlans = (earlier: EarlierPlan[]) => mocks.planFindMany.mockImplementation(
  async ({ where }: { where: { month: string | { lt: string } } }) =>
    typeof where.month === "string" ? revisions : earlier,
);

const octoberPlan = (overrides = {}) => mocks.planFindFirst.mockResolvedValue({
  id: "plan-oct",
  revision: 1,
  createdAt: new Date("2026-09-15T00:00:00Z"),
  allocations: [allocation("food", "EXPENSE", overrides)],
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
    servePlans([]);
    mocks.incomeFindFirst.mockResolvedValue({ nextDueDate: new Date("2026-09-20T00:00:00Z") });
    serveTransactions([
      { categoryId: "food", type: "EXPENSE", amount: 4_000, date: new Date("2026-09-10T04:00:00Z") },
      { categoryId: "other", type: "EXPENSE", amount: 500, date: new Date("2026-09-11T04:00:00Z") },
      { categoryId: "food", type: "EXPENSE", amount: 9_000, date: new Date("2026-09-20T04:00:00Z") },
    ]);
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

  it("derives carry-in on read, so spending logged after the plan was saved still counts", async () => {
    octoberPlan();
    servePlans([{ month: "2026-09", allocations: [{ categoryId: "food", amount: 10_000 }] }]);
    serveTransactions([expense("2026-09-10", 3_000), expense("2026-09-14", 2_000)]);

    const result = await getBudgetPerformance("user-1", "2026-10", -480);

    expect(result.allocations[0]).toMatchObject({ rolloverCarryIn: 5_000, available: 11_000 });
  });

  it("carries a remainder through consecutive months, using each month's newest revision", async () => {
    octoberPlan();
    servePlans([
      { month: "2026-09", allocations: [{ categoryId: "food", amount: 10_000 }] },
      { month: "2026-09", allocations: [{ categoryId: "food", amount: 99_000 }] },
      { month: "2026-08", allocations: [{ categoryId: "food", amount: 5_000 }] },
      { month: "2026-06", allocations: [{ categoryId: "food", amount: 99_000 }] },
    ]);
    serveTransactions([expense("2026-08-20", 4_000), expense("2026-09-10", 5_000)]);

    const result = await getBudgetPerformance("user-1", "2026-10", -480);

    // August leaves 1,000; September leaves 1,000 + 10,000 - 5,000. July has no plan, so June is out.
    expect(result.allocations[0].rolloverCarryIn).toBe(6_000);
    const carryQuery = mocks.transactionFindMany.mock.calls[0][0];
    expect(carryQuery.where.date.gte.toISOString()).toBe("2026-07-31T16:00:00.000Z");
  });

  it("counts a future month's days until payday from the first of that month", async () => {
    vi.setSystemTime(new Date("2026-09-25T04:00:00Z"));
    octoberPlan({ rolloverEnabled: false });
    mocks.incomeFindFirst.mockResolvedValue({ nextDueDate: new Date("2026-10-05T00:00:00Z") });

    const result = await getBudgetPerformance("user-1", "2026-10", -480);

    expect(result.safeToSpend).toMatchObject({ nextIncomeDate: "2026-10-05", daysUntilNextIncome: 4 });
  });
});

describe("saveBudgetPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.categoryFindMany.mockResolvedValue([{ id: "food", type: "EXPENSE" }]);
  });

  it("creates the next immutable revision and stores no carry-in", async () => {
    const create = vi.fn(async ({ data }: { data: { revision: number; allocations: { create: unknown[] } } }) => ({
      id: "plan-3",
      revision: data.revision,
      allocations: data.allocations.create,
    }));
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      budgetPlan: { findFirst: vi.fn().mockResolvedValue({ revision: 2 }), create },
    }));

    const result = await saveBudgetPlan("user-1", "2026-09", {
      allocations: [{ categoryId: "food", amount: 7_000, kind: "FLEXIBLE", rolloverEnabled: true }],
    });

    expect(result.revision).toBe(3);
    expect(create.mock.calls[0][0].data.allocations.create[0]).not.toHaveProperty("rolloverCarryIn");
    expect(mocks.transactionFindMany).not.toHaveBeenCalled();
  });
});
