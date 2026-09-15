import type { BudgetAllocationKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildBudgetAllocations,
  buildBudgetTotals,
  buildSafeToSpend,
  budgetForecastStatus,
  calculateRolloverCarryIn,
} from "@/lib/budget-performance";
import {
  daysInCalendarMonth,
  describePeriodProgress,
  localCalendarDay,
} from "@/lib/period-progress";
import type { BudgetPerformanceData } from "@/types";
import type { BudgetPlanInput } from "@/lib/validations";

const PLAN_INCLUDE = { allocations: { include: { category: true } } } as const;
type PlanWithAllocations = Prisma.BudgetPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

export class BudgetPlanError extends Error {}

const monthRange = (month: string, timezoneOffset: number) => {
  const from = `${month}-01`;
  const to = `${month}-${String(daysInCalendarMonth(month)).padStart(2, "0")}`;
  const offsetMs = timezoneOffset * 60_000;
  return {
    from,
    to,
    start: new Date(Date.parse(`${from}T00:00:00.000Z`) + offsetMs),
    end: new Date(Date.parse(`${to}T23:59:59.999Z`) + offsetMs),
  };
};

const previousMonth = (month: string): string => {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const amountsByCategory = (
  rows: Array<{ categoryId: string; amount: number }>,
): Map<string, number> => {
  const amounts = new Map<string, number>();
  rows.forEach((row) => amounts.set(row.categoryId, (amounts.get(row.categoryId) ?? 0) + row.amount));
  return amounts;
};

const carryInByCategory = async (
  userId: string,
  month: string,
  timezoneOffset: number,
): Promise<Map<string, number>> => {
  const priorMonth = previousMonth(month);
  const priorPlan = await prisma.budgetPlan.findFirst({
    where: { userId, month: priorMonth },
    orderBy: { revision: "desc" },
    include: PLAN_INCLUDE,
  });
  if (!priorPlan) return new Map();

  const range = monthRange(priorMonth, timezoneOffset);
  const transactions = await prisma.transaction.findMany({
    where: { userId, type: "EXPENSE", date: { gte: range.start, lte: range.end } },
    select: { categoryId: true, amount: true },
  });
  const actual = amountsByCategory(transactions);
  return new Map(priorPlan.allocations
    .filter((allocation) => allocation.category.type === "EXPENSE")
    .map((allocation) => [
      allocation.categoryId,
      calculateRolloverCarryIn({
        planned: Number(allocation.amount),
        rolloverCarryIn: Number(allocation.rolloverCarryIn),
        rolloverEnabled: allocation.rolloverEnabled,
      }, actual.get(allocation.categoryId) ?? 0),
    ]));
};

const validateAllocations = async (userId: string, input: BudgetPlanInput) => {
  const ids = input.allocations.map((allocation) => allocation.categoryId);
  const categories = await prisma.category.findMany({
    where: { id: { in: ids }, OR: [{ isDefault: true }, { userId }] },
    select: { id: true, type: true },
  });
  if (categories.length !== ids.length) throw new BudgetPlanError("One or more categories are unavailable");

  const typeById = new Map(categories.map((category) => [category.id, category.type]));
  input.allocations.forEach((allocation) => {
    const type = typeById.get(allocation.categoryId);
    if ((type === "INCOME") !== (allocation.kind === "INCOME")) {
      throw new BudgetPlanError("Income categories must use Income; expense categories must use Fixed, Flexible, or Savings");
    }
    if (type === "INCOME" && allocation.rolloverEnabled) {
      throw new BudgetPlanError("Income allocations cannot roll over");
    }
  });
};

export const saveBudgetPlan = async (
  userId: string,
  month: string,
  timezoneOffset: number,
  input: BudgetPlanInput,
): Promise<PlanWithAllocations> => {
  await validateAllocations(userId, input);
  const carry = await carryInByCategory(userId, month, timezoneOffset);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.budgetPlan.findFirst({
      where: { userId, month },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    return tx.budgetPlan.create({
      data: {
        userId,
        month,
        revision: (latest?.revision ?? 0) + 1,
        allocations: {
          create: input.allocations.map((allocation) => ({
            categoryId: allocation.categoryId,
            amount: allocation.amount,
            kind: allocation.kind,
            rolloverEnabled: allocation.rolloverEnabled,
            rolloverCarryIn: allocation.rolloverEnabled ? (carry.get(allocation.categoryId) ?? 0) : 0,
          })),
        },
      },
      include: PLAN_INCLUDE,
    });
  }, { isolationLevel: "Serializable" });
};

const planSources = (plan: PlanWithAllocations | null) => (plan?.allocations ?? []).map((allocation) => ({
  categoryId: allocation.categoryId,
  categoryName: allocation.category.name,
  categoryIcon: allocation.category.icon,
  categoryColor: allocation.category.color,
  type: allocation.category.type,
  kind: allocation.kind as BudgetAllocationKind,
  planned: Number(allocation.amount),
  rolloverEnabled: allocation.rolloverEnabled,
  rolloverCarryIn: Number(allocation.rolloverCarryIn),
}));

const nextIncomeDate = async (userId: string, from: string, to: string): Promise<string | null> => {
  if (from > to) return null;
  const income = await prisma.scheduledTransaction.findFirst({
    where: {
      userId,
      type: "INCOME",
      isActive: true,
      nextDueDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    },
    orderBy: { nextDueDate: "asc" },
    select: { nextDueDate: true },
  });
  return income?.nextDueDate.toISOString().slice(0, 10) ?? null;
};

export const getBudgetPerformance = async (
  userId: string,
  month: string,
  timezoneOffset: number,
): Promise<BudgetPerformanceData> => {
  const range = monthRange(month, timezoneOffset);
  const today = localCalendarDay(new Date(), timezoneOffset);
  const progress = describePeriodProgress(range.from, range.to, today);
  const effectiveTo = progress.effectiveTo
    ? new Date(Date.parse(`${progress.effectiveTo}T23:59:59.999Z`) + timezoneOffset * 60_000)
    : null;

  const [plan, revisions, transactions, incomeDate] = await Promise.all([
    prisma.budgetPlan.findFirst({ where: { userId, month }, orderBy: { revision: "desc" }, include: PLAN_INCLUDE }),
    prisma.budgetPlan.findMany({
      where: { userId, month },
      orderBy: { revision: "desc" },
      select: { id: true, revision: true, createdAt: true },
    }),
    progress.effectiveTo ? prisma.transaction.findMany({
      where: { userId, date: { gte: range.start, lte: effectiveTo! } },
      select: { categoryId: true, amount: true, type: true },
    }) : Promise.resolve([]),
    nextIncomeDate(userId, today < range.from ? range.from : today, range.to),
  ]);

  const plannedType = new Map((plan?.allocations ?? []).map((allocation) => [allocation.categoryId, allocation.category.type]));
  const actualByCategory = amountsByCategory(transactions.filter((row) => plannedType.get(row.categoryId) === row.type));
  const sourceProgress = { isPartial: progress.isPartial, daysElapsed: progress.daysElapsed, daysInMonth: progress.daysInPeriod };
  const allocations = buildBudgetAllocations(planSources(plan), actualByCategory, sourceProgress);
  const actualIncome = transactions.filter((row) => row.type === "INCOME").reduce((sum, row) => sum + row.amount, 0);
  const actualExpenses = transactions.filter((row) => row.type === "EXPENSE").reduce((sum, row) => sum + row.amount, 0);
  const totals = buildBudgetTotals(allocations, actualIncome, actualExpenses, sourceProgress);
  const safeToSpend = buildSafeToSpend(allocations, totals.unbudgetedExpenses, sourceProgress, today, incomeDate);

  return {
    month,
    periodLabel: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`)),
    progress: {
      isPartial: progress.isPartial,
      daysElapsed: progress.daysElapsed,
      daysInMonth: progress.daysInPeriod,
      percentElapsed: Math.round((progress.daysElapsed / progress.daysInPeriod) * 100),
      effectiveTo: progress.effectiveTo,
    },
    plan: plan ? {
      id: plan.id,
      revision: plan.revision,
      revisionCount: revisions.length,
      createdAt: plan.createdAt.toISOString(),
      history: revisions.map((revision) => ({
        id: revision.id,
        revision: revision.revision,
        createdAt: revision.createdAt.toISOString(),
      })),
    } : null,
    allocations,
    totals,
    safeToSpend,
    forecastStatus: budgetForecastStatus(sourceProgress, actualExpenses),
    treatmentNotes: [
      "Expense transactions count toward the category they are filed under; income transactions do not offset expense actuals.",
      "Refunds and reimbursements logged as income remain income. Transfers are not modeled and should not be entered as income or expense.",
      "Savings actuals require an expense category classified as Savings; unspent money is not treated as a contribution.",
    ],
  };
};
