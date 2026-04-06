import { useQuery } from "@tanstack/react-query";
import type { AnalyticsData, AnalyticsGranularity, AnalyticsTypeFilter } from "@/types";

/* ------------------------------------------------------------------ */
/*  Query key factory                                                  */
/* ------------------------------------------------------------------ */

export interface AnalyticsParams {
  granularity: AnalyticsGranularity;
  from: string;
  to: string;
  type: AnalyticsTypeFilter;
}

export const analyticsKeys = {
  all: ["analytics"] as const,
  query: (params: AnalyticsParams, tz: number) => ["analytics", params, tz] as const,
};

/* ------------------------------------------------------------------ */
/*  Fetch helper                                                       */
/* ------------------------------------------------------------------ */

const fetchAnalytics = async (params: AnalyticsParams, tz: number): Promise<AnalyticsData> => {
  const searchParams = new URLSearchParams({
    granularity: params.granularity,
    from: params.from,
    to: params.to,
    tz: String(tz),
    type: params.type,
  });
  const res = await fetch(`/api/analytics?${searchParams}`);
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
};

/* ------------------------------------------------------------------ */
/*  Query hook                                                         */
/* ------------------------------------------------------------------ */

export function useAnalyticsQuery(params: AnalyticsParams, tz: number) {
  return useQuery({
    queryKey: analyticsKeys.query(params, tz),
    queryFn: () => fetchAnalytics(params, tz),
  });
}
