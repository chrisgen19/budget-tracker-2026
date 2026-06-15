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
  dailyTip: (userKey: string) => ["assessment", "daily-tip", userKey] as const,
};

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
  return res.json();
};

export function useDailyTipQuery() {
  const { user } = useUser();
  return useQuery({
    queryKey: assessmentKeys.dailyTip(user.email),
    queryFn: fetchDailyTip,
    staleTime: Infinity,
  });
}
