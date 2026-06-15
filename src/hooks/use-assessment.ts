import { useQuery } from "@tanstack/react-query";
import type { AiAssessmentResponse, AiDailyTipResponse } from "@/types";

/* ------------------------------------------------------------------ */
/*  Keys                                                               */
/* ------------------------------------------------------------------ */

export interface AssessmentPeriod {
  granularity: string;
  from: string;
  to: string;
}

export const assessmentKeys = {
  all: ["assessment"] as const,
  report: (p: AssessmentPeriod) => ["assessment", "report", p] as const,
  dailyTip: ["assessment", "daily-tip"] as const,
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
  return useQuery({
    queryKey: assessmentKeys.report(p),
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
  return useQuery({
    queryKey: assessmentKeys.dailyTip,
    queryFn: fetchDailyTip,
    staleTime: Infinity,
  });
}
