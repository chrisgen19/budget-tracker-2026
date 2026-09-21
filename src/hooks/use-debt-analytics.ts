import { useQuery } from "@tanstack/react-query";
import type { CardInterestFacts } from "@/lib/card-interest";

export interface DebtStrategyView {
  order: string[];
  months: number;
  totalInterest: number;
  stalled: boolean;
}

export interface DebtCardView {
  id: string;
  name: string;
  balance: number;
  utilization: number | null;
  apr: number | null;
  creditLimit: number | null;
  isActive: boolean;
  plannedPayment: number | null;
  minimumPaymentPct: number | null;
  minimumPaymentFloor: number | null;
  observedMonthly: number | null;
}

export interface DebtAnalytics {
  totalOwed: number;
  owedOverTime: Array<{ month: string; owed: number }>;
  interest: CardInterestFacts;
  cards: DebtCardView[];
  strategies: { avalanche: DebtStrategyView; snowball: DebtStrategyView; monthlyPool: number } | null;
}

export const debtAnalyticsKeys = {
  all: ["debt-analytics"] as const,
  range: (from: string, to: string) => ["debt-analytics", from, to] as const,
};

/** The Debt tab's portfolio view. Only mounted when the credit cards switch admits the user. */
export function useDebtAnalytics(from: string, to: string) {
  return useQuery({
    queryKey: debtAnalyticsKeys.range(from, to),
    queryFn: async (): Promise<DebtAnalytics> => {
      const response = await fetch(`/api/analytics/debt?from=${from}&to=${to}`);
      if (!response.ok) throw new Error("Could not load debt analytics");
      return response.json();
    },
  });
}
