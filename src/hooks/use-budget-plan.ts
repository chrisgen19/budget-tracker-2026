import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { analyticsKeys } from "@/hooks/use-analytics";
import { cashFlowForecastKeys } from "@/hooks/use-cash-flow-forecast";
import type { BudgetPerformanceData } from "@/types";
import type { BudgetPlanInput } from "@/lib/validations";

export const budgetPlanKeys = {
  all: ["budget-plans"] as const,
  month: (month: string, timezoneOffset: number) => ["budget-plans", month, timezoneOffset] as const,
};

const fetchBudgetPerformance = async (
  month: string,
  timezoneOffset: number,
): Promise<BudgetPerformanceData> => {
  const params = new URLSearchParams({ month, tz: String(timezoneOffset) });
  const response = await fetch(`/api/budgets?${params}`);
  if (!response.ok) throw new Error("Failed to load budget plan");
  return response.json();
};

export function useBudgetPerformance(
  month: string,
  timezoneOffset: number,
  enabled = true,
) {
  return useQuery({
    queryKey: budgetPlanKeys.month(month, timezoneOffset),
    queryFn: () => fetchBudgetPerformance(month, timezoneOffset),
    enabled,
  });
}

export function useSaveBudgetPlan(month: string, timezoneOffset: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BudgetPlanInput) => {
      const response = await fetch(`/api/budgets/${month}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to save budget plan");
      return body as { id: string; revision: number };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: budgetPlanKeys.month(month, timezoneOffset) }),
        queryClient.invalidateQueries({ queryKey: analyticsKeys.all }),
        queryClient.invalidateQueries({ queryKey: cashFlowForecastKeys.all }),
      ]);
    },
  });
}
