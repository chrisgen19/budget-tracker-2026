import { useQuery } from "@tanstack/react-query";

/* ------------------------------------------------------------------ */
/*  Shared /api/preferences query                                      */
/*  One cache entry so quick-category + quick-label consumers don't    */
/*  each fire their own request (and pins are ready on first paint).   */
/* ------------------------------------------------------------------ */

export interface Preferences {
  hideAmounts: boolean;
  quickExpenseCategories: string[];
  quickIncomeCategories: string[];
  quickLabels: string[];
  receiptScanEnabled: boolean;
  transactionLayout: string;
  transactionAmountAutofocus: boolean;
  defaultLabelType: string;
  showDayName: boolean;
  dayNameFormat: string;
  emailBillReminders: boolean;
}

export const preferencesKeys = {
  all: ["preferences"] as const,
};

const fetchPreferences = async (): Promise<Preferences> => {
  const res = await fetch("/api/preferences");
  if (!res.ok) throw new Error("Failed to fetch preferences");
  return res.json();
};

/** Shared preferences query. Pass `select` to derive a slice without an extra fetch. */
export function usePreferencesQuery<T = Preferences>(select?: (data: Preferences) => T) {
  return useQuery({
    queryKey: preferencesKeys.all,
    queryFn: fetchPreferences,
    select,
  });
}
