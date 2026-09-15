export type AssessmentComparisonStatus =
  | "available"
  | "low-coverage"
  | "no-previous-data"
  | "not-started"
  | "too-early";

interface AssessmentComparisonInput {
  summary: {
    totalIncome: number;
    totalExpenses: number;
  };
  previousSummary: {
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
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

export interface AssessmentPreviousTotals {
  income: number;
  expenses: number;
  net: number;
}

/**
 * Whether the previous period is a fair baseline. Payloads sent before Analytics
 * carried a status fall back to "the previous period has any transactions".
 */
export const hasComparablePeriods = (payload: AssessmentComparisonInput): boolean =>
  payload.periodContext
    ? payload.periodContext.comparisonStatus === "available"
    : payload.previousSummary.transactionCount > 0;

/** Keep model-visible comparisons behind the same confidence gate as Analytics. */
export const buildAssessmentComparisonSignals = (
  payload: AssessmentComparisonInput,
): AssessmentComparisonSignals => {
  const hasComparableData = hasComparablePeriods(payload);
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

/**
 * The previous period's totals, withheld along with the percentages. Handed both
 * sets of totals, the model can work out the very change the gate just hid.
 */
export const buildAssessmentPreviousTotals = (
  payload: AssessmentComparisonInput,
): AssessmentPreviousTotals | null =>
  hasComparablePeriods(payload)
    ? {
      income: payload.previousSummary.totalIncome,
      expenses: payload.previousSummary.totalExpenses,
      net: payload.previousSummary.netCashFlow,
    }
    : null;
