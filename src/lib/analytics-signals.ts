import type {
  AnalyticsCashFlowSignals,
  AnalyticsSummary,
} from "@/types";

interface ExpenseDayStatistics {
  expenseDays: number;
  totalDaysInPeriod: number;
}

const savingsRate = ({ totalIncome, netCashFlow }: AnalyticsSummary): number | null =>
  totalIncome > 0 ? netCashFlow / totalIncome : null;

/** A zero baseline has no meaningful relative change unless both values are zero. */
const relativeChange = (
  current: number,
  previous: number,
  hasPreviousData: boolean,
): number | null => {
  if (!hasPreviousData) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
};

/**
 * Describe what the selected transaction windows say without grading it.
 *
 * More categories and more spending days are not inherently healthy, and the
 * ledger has no assets, debts, liquid-savings balance or goals from which to
 * infer broader financial wellbeing. Those inputs therefore do not become a
 * composite score here.
 */
export const computeCashFlowSignals = (
  summary: AnalyticsSummary,
  previousSummary: AnalyticsSummary,
  statistics: ExpenseDayStatistics,
): AnalyticsCashFlowSignals => {
  const hasPreviousData = previousSummary.transactionCount > 0;
  const currentSavingsRate = savingsRate(summary);
  const priorSavingsRate = hasPreviousData ? savingsRate(previousSummary) : null;

  return {
    netCashFlow: summary.netCashFlow,
    savingsRate: currentSavingsRate,
    previousSavingsRate: priorSavingsRate,
    savingsRateChange:
      currentSavingsRate !== null && priorSavingsRate !== null
        ? currentSavingsRate - priorSavingsRate
        : null,
    expenseChange: relativeChange(
      summary.totalExpenses,
      previousSummary.totalExpenses,
      hasPreviousData,
    ),
    incomeChange: relativeChange(
      summary.totalIncome,
      previousSummary.totalIncome,
      hasPreviousData,
    ),
    expenseDays: statistics.expenseDays,
    totalDaysInPeriod: statistics.totalDaysInPeriod,
    hasPreviousData,
  };
};
