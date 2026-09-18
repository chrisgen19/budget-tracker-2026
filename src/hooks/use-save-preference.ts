"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser, type UserInfo } from "@/components/user-provider";
import { useToast } from "@/components/ui/toast";
import { analyticsKeys } from "@/hooks/use-analytics";

/**
 * The preference fields `PATCH /api/preferences` accepts and `UserInfo` mirrors.
 *
 * Deliberately a narrow union rather than `keyof UserInfo`. The context also carries `name`,
 * `role`, `maxUploadFiles` and other fields the endpoint will not take, and sending one is a 400
 * that the optimistic update has already applied on screen. Naming them here makes that a
 * compile error instead.
 */
export type SavablePreference =
  | "showDayName"
  | "dayNameFormat"
  | "receiptScanEnabled"
  | "transactionLayout"
  | "transactionAmountAutofocus"
  | "defaultLabelType"
  | "emailBillReminders"
  | "telegramDailyPrompt"
  | "telegramDailyPromptTime"
  | "watchlistOutlierRatio"
  | "watchlistLargeAmount"
  | "watchlistDuplicateAlerts";

/**
 * Preferences the assessment facts are computed from.
 *
 * `assessmentKeys.facts` is nested under `analyticsKeys.all` so that every *financial* mutation
 * invalidates it without anyone maintaining a second list of call sites. A threshold is not one:
 * it changes how the same rows are judged, so nothing on this path would otherwise touch the
 * cache. Inside the facts query's five-minute `staleTime` that means saving a threshold and going
 * straight to the Watchlist - which is the whole reason to change one - shows findings computed
 * with the old value, and a setting that visibly does nothing reads as broken.
 *
 * A set here rather than three `invalidateQueries` calls in `WatchlistForm`: this file exists
 * because nine hand-written copies of the save dance had already drifted, and a fourth Watchlist
 * setting added later is exactly what forgets the fourth copy.
 */
const ANALYTICS_AFFECTING: ReadonlySet<SavablePreference> = new Set([
  "watchlistOutlierRatio",
  "watchlistLargeAmount",
  "watchlistDuplicateAlerts",
]);

/**
 * Save one preference optimistically, and say so when it does not stick.
 *
 * Every toggle on the profile page applied its new value immediately, PATCHed, and on failure
 * put the old value back **without telling anyone**. From the user's side a switch flips, flips
 * back a moment later, and nothing explains why - which reads as the control being broken rather
 * than the save failing. The time input was the worst of them, since a reverted time looks like
 * the field simply refusing input.
 *
 * The optimistic update is worth keeping: a toggle that waits for a round trip feels broken in
 * the other direction. What was missing was the failure half of it.
 *
 * Written once because there were nine copies of this dance, spread across two sibling tabs of
 * the same page, and they had already drifted in small ways. A tenth copy is how the next one
 * goes silent again - which is exactly how the Preferences tab was missed on the first pass.
 */
export function useSavePreference() {
  const { setUser } = useUser();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  return useCallback(
    async <K extends SavablePreference>(
      key: K,
      next: UserInfo[K],
      previous: UserInfo[K],
      /** Named in the failure message, so it says which control gave up. */
      label: string
    ): Promise<boolean> => {
      // Cast because TypeScript cannot see that a computed key of a generic parameter still
      // produces a valid `Partial<UserInfo>`; `K` is constrained to keys that do.
      const apply = (value: UserInfo[K]) => setUser({ [key]: value } as Partial<UserInfo>);

      apply(next);

      try {
        const res = await fetch("/api/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: next }),
        });

        if (!res.ok) {
          apply(previous);
          // The two failures need different advice: the server refused this value, versus the
          // request never arrived. Telling someone to check their connection when the server
          // rejected the value sends them to look at the wrong thing.
          showToast(`Could not save ${label}. Please try again.`, "error");
          return false;
        }

        // Only after the server took it. A rollback leaves the cache agreeing with the database,
        // so invalidating on a refusal would spend a refetch to arrive back where it started.
        if (ANALYTICS_AFFECTING.has(key)) {
          queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
        }

        return true;
      } catch {
        apply(previous);
        showToast(`Could not save ${label}. Check your connection.`, "error");
        return false;
      }
    },
    [setUser, showToast, queryClient]
  );
}
