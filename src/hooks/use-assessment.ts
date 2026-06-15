import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/components/user-provider";
import type { AiAssessmentResponse, AiDailyTipResponse } from "@/types";

/* ------------------------------------------------------------------ */
/*  Keys — scoped by user so a shared queryClient can't leak cached    */
/*  reports/tips across accounts on the same browser session.          */
/* ------------------------------------------------------------------ */

export interface AssessmentPeriod {
  granularity: string;
  from: string;
  to: string;
}

export const assessmentKeys = {
  all: ["assessment"] as const,
  report: (userKey: string, p: AssessmentPeriod) => ["assessment", "report", userKey, p] as const,
  // localDate in the key so the tip naturally refetches once the user crosses local midnight.
  dailyTip: (userKey: string, localDate: string) => ["assessment", "daily-tip", userKey, localDate] as const,
};

/** The user's current calendar date (YYYY-MM-DD) given their tz offset in minutes. */
export const localDateFor = (timezoneOffset: number): string =>
  new Date(Date.now() - timezoneOffset * 60_000).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
/*  Cached report (GET)                                                */
/* ------------------------------------------------------------------ */

const fetchReport = async (p: AssessmentPeriod): Promise<AiAssessmentResponse> => {
  const search = new URLSearchParams({ granularity: p.granularity, from: p.from, to: p.to });
  const res = await fetch(`/api/assessment?${search}`);
  if (!res.ok) throw new Error("Failed to load assessment");
  return res.json();
};

export function useAssessmentQuery(p: AssessmentPeriod) {
  const { user } = useUser();
  return useQuery({
    queryKey: assessmentKeys.report(user.email, p),
    queryFn: () => fetchReport(p),
    staleTime: Infinity, // cached server-side per period; only refetch on explicit generate
  });
}

/* ------------------------------------------------------------------ */
/*  Daily tip (GET, lazily generated server-side)                      */
/* ------------------------------------------------------------------ */

const fetchDailyTip = async (): Promise<AiDailyTipResponse> => {
  const res = await fetch("/api/assessment/daily-tip");
  if (!res.ok) throw new Error("Failed to load daily tip");
  const data: AiDailyTipResponse = await res.json();
  // The route returns 200 { tip: null } when generation transiently fails (it degrades
  // gracefully). Treat that as an error so React Query doesn't cache the failure for the
  // whole local day (staleTime: Infinity) — it retries on the next visit and caches once it succeeds.
  if (!data.tip) throw new Error("Daily tip unavailable");
  return data;
};

export function useDailyTipQuery() {
  const { user } = useUser();
  return useQuery({
    queryKey: assessmentKeys.dailyTip(user.email, localDateFor(user.timezoneOffset)),
    queryFn: fetchDailyTip,
    staleTime: Infinity,
  });
}
