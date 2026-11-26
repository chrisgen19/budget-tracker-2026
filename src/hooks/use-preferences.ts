import { useQuery } from "@tanstack/react-query";
import { ApiRefusedError } from "@/hooks/api-error";

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
  telegramDailyPrompt: boolean;
  telegramDailyPromptTime: string;
  telegramWatchlistDigest: boolean;
  telegramWatchlistDigestTime: string;
  /** ISO instant the MCP write lease ends, or `null` when writes are off. Read-only here. */
  mcpWritesEnabledUntil: string | null;
}

/** Fields `PATCH /api/preferences` takes as-is. The write lease has its own request. */
export type PreferencesPatch = Partial<Omit<Preferences, "mcpWritesEnabledUntil">>;

export const preferencesKeys = {
  all: ["preferences"] as const,
};

export const fetchPreferences = async (): Promise<Preferences> => {
  const res = await fetch("/api/preferences");
  if (!res.ok) throw new Error("Failed to fetch preferences");
  return res.json();
};

/**
 * Save preference fields. Resolves when stored, rejects with `ApiRefusedError` when the server
 * refuses, and with the network error when the request never arrived.
 *
 * Does not read the response body: no caller needs it, and an unreadable body on a save that
 * landed must not be reported as a failure.
 */
export const savePreferences = async (patch: PreferencesPatch): Promise<void> => {
  const res = await fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new ApiRefusedError("Failed to save preferences", res.status);
};

/** Shared preferences query. Pass `select` to derive a slice without an extra fetch. */
export function usePreferencesQuery<T = Preferences>(select?: (data: Preferences) => T) {
  return useQuery({
    queryKey: preferencesKeys.all,
    queryFn: fetchPreferences,
    select,
  });
}
