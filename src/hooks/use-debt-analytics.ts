import { useQuery } from "@tanstack/react-query";
import { creditAccountKeys } from "@/hooks/use-credit-accounts";
import type { CardInterestFacts, OverallUtilization } from "@/lib/card-interest";

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
  /** Across every card at once, or null when no card carries a limit. */
  overallUtilization: OverallUtilization | null;
  owedOverTime: Array<{ month: string; owed: number }>;
  interest: CardInterestFacts;
  cards: DebtCardView[];
  strategies: { avalanche: DebtStrategyView; snowball: DebtStrategyView; monthlyPool: number } | null;
}

/**
 * Nested under the card root on purpose. Everything the tab shows is derived from card reads, and
 * every write that moves a card -- a payment, a purchase, an edit or delete on /transactions --
 * already invalidates `creditAccountKeys.all`. As a root of its own (`["debt-analytics"]`) nothing
 * ever invalidated it, so the tab kept showing what was owed before a payment for as long as the
 * five-minute stale time ran.
 */
export const debtAnalyticsKeys = {
  all: [...creditAccountKeys.all, "debt"] as const,
  range: (from: string, to: string) => [...creditAccountKeys.all, "debt", from, to] as const,
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
