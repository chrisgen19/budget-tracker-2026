import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type CashFlowForecast = {
  configured: boolean; today: string; horizonDays: number; openingBalance?: number; openingBalanceDate?: string; trackedBalanceToday?: number;
  lowestBalance?: { date: string; balance: number } | null; cashCrunches?: Array<{ date: string; balance: number }>;
  assumptions: string[];
  daily?: Array<{ date: string; projectedBalance: number; inflows: number; outflows: number; events: Array<{ description: string; kind: string; estimated: boolean; assumption: string }> }>;
};

const keys = { all: ["cash-flow-forecast"] as const, forecast: (days: number, tz: number) => ["cash-flow-forecast", days, tz] as const };

export function useCashFlowForecast(days: number, timezoneOffset: number) {
  return useQuery({
    queryKey: keys.forecast(days, timezoneOffset),
    queryFn: async (): Promise<CashFlowForecast> => {
      const response = await fetch(`/api/cash-flow-forecast?days=${days}&tz=${timezoneOffset}`);
      if (!response.ok) throw new Error("Could not load the cash-flow forecast");
      return response.json();
    },
  });
}

export function useSaveForecastOpeningBalance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { openingBalance: number; openingBalanceDate: string }) => {
      const response = await fetch("/api/cash-flow-forecast", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!response.ok) throw new Error("Could not save the opening tracked balance");
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all }),
  });
}
