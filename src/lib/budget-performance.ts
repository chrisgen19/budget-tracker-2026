import type { BudgetAllocationKind } from "@prisma/client";
import type {
  BudgetForecastStatus,
  BudgetPerformanceAllocation,
  BudgetPerformanceTotals,
  BudgetSafeToSpend,
} from "@/types";

export interface BudgetAllocationSource {
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  type: "INCOME" | "EXPENSE";
  kind: BudgetAllocationKind;
  planned: number;
  rolloverEnabled: boolean;
  rolloverCarryIn: number;
}

export interface BudgetProgressSource {
  isPartial: boolean;
  daysElapsed: number;
  daysInMonth: number;
}

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateRolloverCarryIn = (
  previous: { planned: number; rolloverCarryIn: number; rolloverEnabled: boolean } | null,
  previousActual: number,
): number => previous?.rolloverEnabled
  ? money(previous.planned + previous.rolloverCarryIn - previousActual)
  : 0;

const previousCalendarMonth = (month: string): string => {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** One month's plan in force, reduced to the expense allocations that roll their remainder on. */
export interface RolloverPlanMonth {
  month: string;
  allocations: Array<{ categoryId: string; planned: number }>;
}

/**
 * The unbroken run of rolling months that ends the month before `month`, oldest first. It stops at
 * a month with no plan or nothing rolling, since no remainder can cross that month.
 */
export const rolloverChain = (
  month: string,
  plansByMonth: ReadonlyMap<string, RolloverPlanMonth>,
): RolloverPlanMonth[] => {
  const chain: RolloverPlanMonth[] = [];
  let plan = plansByMonth.get(previousCalendarMonth(month));
  while (plan && plan.allocations.length > 0) {
    chain.unshift(plan);
    plan = plansByMonth.get(previousCalendarMonth(plan.month));
  }
  return chain;
};

/**
 * Carry-in for the month after the newest plan in `chain`, walked forward from the oldest.
 *
 * Derived rather than stored: a plan is usually saved before the month it follows has ended, and a
 * remainder frozen at that moment never sees the rest of that month's spending.
 */
export const deriveRolloverCarryIn = (
  chain: RolloverPlanMonth[],
  actualByMonth: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<string, number> => chain.reduce(
  (carry, plan) => new Map(plan.allocations.map((allocation): [string, number] => [
    allocation.categoryId,
    calculateRolloverCarryIn(
      { planned: allocation.planned, rolloverCarryIn: carry.get(allocation.categoryId) ?? 0, rolloverEnabled: true },
      actualByMonth.get(plan.month)?.get(allocation.categoryId) ?? 0,
    ),
  ])),
  new Map<string, number>(),
);

const projectedActual = (
  actual: number,
  kind: BudgetAllocationKind,
  progress: BudgetProgressSource,
): number | null => {
  if (progress.daysElapsed === 0) return null;
  if (!progress.isPartial || kind !== "FLEXIBLE") return money(actual);
  return money((actual / progress.daysElapsed) * progress.daysInMonth);
};

const projectionBasis = (
  kind: BudgetAllocationKind,
  progress: BudgetProgressSource,
): string => {
  if (progress.daysElapsed === 0) return "The month has not started.";
  if (!progress.isPartial) return "The month is complete, so projected equals actual.";
  if (kind === "FLEXIBLE") {
    return `Current average daily spend across ${progress.daysElapsed} elapsed calendar days.`;
  }
  if (kind === "FIXED") return "Fixed allocations are not multiplied as if they repeat daily.";
  if (kind === "SAVINGS") return "Savings contributions are reported as logged, not pace-multiplied.";
  return "Planned income is compared with income logged so far.";
};

export const buildBudgetAllocations = (
  sources: BudgetAllocationSource[],
  actualByCategory: ReadonlyMap<string, number>,
  progress: BudgetProgressSource,
): BudgetPerformanceAllocation[] => sources.map((source) => {
  const actual = money(actualByCategory.get(source.categoryId) ?? 0);
  const available = money(source.planned + (source.type === "EXPENSE" ? source.rolloverCarryIn : 0));
  const remaining = money(available - actual);
  const projected = projectedActual(actual, source.kind, progress);
  const varianceAmount = source.type === "INCOME" ? money(actual - source.planned) : remaining;
  const varianceBase = source.type === "INCOME" ? source.planned : available;
  return {
    ...source,
    available,
    actual,
    remaining,
    varianceAmount,
    variancePct: varianceBase === 0 ? null : varianceAmount / varianceBase,
    projectedActual: projected,
    forecastToExceed: source.type === "EXPENSE" && (actual > available || (projected ?? 0) > available),
    projectionBasis: projectionBasis(source.kind, progress),
    rolloverCarryOut: source.type === "EXPENSE" && source.rolloverEnabled ? remaining : null,
  };
});

export const buildBudgetTotals = (
  allocations: BudgetPerformanceAllocation[],
  actualIncome: number,
  actualExpenses: number,
  progress: BudgetProgressSource,
): BudgetPerformanceTotals => {
  const expenseRows = allocations.filter((row) => row.type === "EXPENSE");
  const budgetedActual = expenseRows.reduce((sum, row) => sum + row.actual, 0);
  const projectedBudgeted = expenseRows.reduce((sum, row) => sum + (row.projectedActual ?? row.actual), 0);
  const unbudgetedExpenses = Math.max(0, money(actualExpenses - budgetedActual));
  const availableExpenses = money(expenseRows.reduce((sum, row) => sum + row.available, 0));
  const projectedUnbudgeted = progress.isPartial && progress.daysElapsed > 0
    ? (unbudgetedExpenses / progress.daysElapsed) * progress.daysInMonth
    : unbudgetedExpenses;
  const projectedExpenses = allocations.length === 0 || progress.daysElapsed === 0 || actualExpenses === 0
    ? null
    : money(projectedBudgeted + projectedUnbudgeted);

  return {
    plannedIncome: money(allocations.filter((row) => row.type === "INCOME").reduce((sum, row) => sum + row.planned, 0)),
    actualIncome: money(actualIncome),
    plannedExpenses: money(expenseRows.reduce((sum, row) => sum + row.planned, 0)),
    availableExpenses,
    actualExpenses: money(actualExpenses),
    unbudgetedExpenses,
    remainingExpenses: money(availableExpenses - actualExpenses),
    projectedExpenses,
    projectedVariance: projectedExpenses === null ? null : money(availableExpenses - projectedExpenses),
  };
};

export const budgetForecastStatus = (
  progress: BudgetProgressSource,
  actualExpenses: number,
): BudgetForecastStatus => {
  if (progress.daysElapsed === 0) return "not-started";
  return actualExpenses === 0 ? "no-activity" : "available";
};

/**
 * Flexible money left to spend, per day and until the next scheduled income.
 *
 * `countFrom` is the first day the allowance covers: today, or the first of the month when the
 * month has not started. Counting a future month's payday from today would spread the daily figure
 * over days that belong to the month before.
 */
export const buildSafeToSpend = (
  allocations: BudgetPerformanceAllocation[],
  unbudgetedExpenses: number,
  progress: BudgetProgressSource,
  countFrom: string,
  nextIncomeDate: string | null,
): BudgetSafeToSpend => {
  const flexibleRemaining = allocations
    .filter((row) => row.type === "EXPENSE" && row.kind === "FLEXIBLE")
    .reduce((sum, row) => sum + row.remaining, 0) - unbudgetedExpenses;
  const remainingFlexible = money(Math.max(0, flexibleRemaining));
  const spendingDaysRemaining = progress.daysElapsed === 0
    ? progress.daysInMonth
    : progress.isPartial
      ? progress.daysInMonth - progress.daysElapsed + 1
      : 0;
  const perDay = spendingDaysRemaining > 0 ? money(remainingFlexible / spendingDaysRemaining) : null;
  const daysUntilNextIncome = nextIncomeDate && perDay !== null
    ? Math.max(0, Math.round((Date.parse(`${nextIncomeDate}T00:00:00Z`) - Date.parse(`${countFrom}T00:00:00Z`)) / 86_400_000))
    : null;

  return {
    remainingFlexible,
    perDay,
    perWeek: perDay === null ? null : money(perDay * 7),
    untilNextIncome: daysUntilNextIncome === null || perDay === null ? null : money(perDay * daysUntilNextIncome),
    nextIncomeDate,
    daysUntilNextIncome,
    basis: "Unspent flexible allocations minus unbudgeted expenses, spread evenly across the remaining calendar days. Fixed and savings allocations stay reserved.",
  };
};
