import { describe, expect, it } from "vitest";
import { buildAssessmentComparisonSignals } from "@/lib/assessment-comparison";

const payload = {
  summary: { totalIncome: 1_200, totalExpenses: 900 },
  previousSummary: {
    totalIncome: 1_000,
    totalExpenses: 1_000,
    transactionCount: 4,
  },
};

describe("buildAssessmentComparisonSignals", () => {
  it("includes changes only when the shared comparison status is available", () => {
    expect(buildAssessmentComparisonSignals({
      ...payload,
      periodContext: { comparisonStatus: "available" },
    })).toEqual({ expenseChangePct: -10, incomeChangePct: 20 });
  });

  it.each(["low-coverage", "no-previous-data", "not-started"] as const)(
    "withholds changes when the comparison status is %s",
    (comparisonStatus) => {
      expect(buildAssessmentComparisonSignals({
        ...payload,
        periodContext: { comparisonStatus },
      })).toEqual({ expenseChangePct: null, incomeChangePct: null });
    },
  );

  it("preserves the transaction-count fallback for legacy payloads", () => {
    expect(buildAssessmentComparisonSignals(payload)).toEqual({
      expenseChangePct: -10,
      incomeChangePct: 20,
    });
    expect(buildAssessmentComparisonSignals({
      ...payload,
      previousSummary: { ...payload.previousSummary, transactionCount: 0 },
    })).toEqual({ expenseChangePct: null, incomeChangePct: null });
  });
});
