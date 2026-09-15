export type AssessmentComparisonStatus =
  | "available"
  | "low-coverage"
  | "no-previous-data"
  | "not-started";

interface AssessmentComparisonInput {
  summary: {
    totalIncome: number;
    totalExpenses: number;
  };
  previousSummary: {
    totalIncome: number;
    totalExpenses: number;
    transactionCount: number;
  };
  periodContext?: {
    comparisonStatus: AssessmentComparisonStatus;
  };
}

export interface AssessmentComparisonSignals {
  expenseChangePct: number | null;
  incomeChangePct: number | null;
}

/** Keep model-visible comparisons behind the same confidence gate as Analytics. */
export const buildAssessmentComparisonSignals = (
  payload: AssessmentComparisonInput,
): AssessmentComparisonSignals => {
  const hasComparableData = payload.periodContext
    ? payload.periodContext.comparisonStatus === "available"
    : payload.previousSummary.transactionCount > 0;
  const percentageChange = (current: number, previous: number): number | null =>
    hasComparableData && previous !== 0
      ? Math.round(((current - previous) / previous) * 100)
      : null;

  return {
    expenseChangePct: percentageChange(
      payload.summary.totalExpenses,
      payload.previousSummary.totalExpenses,
    ),
    incomeChangePct: percentageChange(
      payload.summary.totalIncome,
      payload.previousSummary.totalIncome,
    ),
  };
};
