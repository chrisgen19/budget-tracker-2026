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
  hasComparableData: boolean,
): number | null => {
  if (!hasComparableData) return null;
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
  hasComparableData = previousSummary.transactionCount > 0,
): AnalyticsCashFlowSignals => {
  const currentSavingsRate = savingsRate(summary);
  const priorSavingsRate = hasComparableData ? savingsRate(previousSummary) : null;

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
      hasComparableData,
    ),
    incomeChange: relativeChange(
      summary.totalIncome,
      previousSummary.totalIncome,
      hasComparableData,
    ),
    expenseDays: statistics.expenseDays,
    totalDaysInPeriod: statistics.totalDaysInPeriod,
    hasComparableData,
  };
};
