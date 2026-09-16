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

export class AnalyticsRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AnalyticsRequestError";
  }
}

export const shouldRetryAnalyticsRequest = (failureCount: number, error: Error): boolean =>
  !(error instanceof AnalyticsRequestError && error.status >= 400 && error.status < 500) && failureCount < 1;

const responseErrorMessage = (body: unknown): string => {
  if (!body || typeof body !== "object" || !("error" in body)) return "Failed to fetch analytics";
  const errors = body.error;
  if (!errors || typeof errors !== "object") return "Failed to fetch analytics";
  const message = Object.values(errors).flat().find((value): value is string => typeof value === "string");
  return message ?? "Failed to fetch analytics";
};

/* ------------------------------------------------------------------ */
/*  Fetch helper                                                       */
/* ------------------------------------------------------------------ */

export const fetchAnalytics = async (params: AnalyticsParams, tz: number): Promise<AnalyticsData> => {
  const searchParams = new URLSearchParams({
    granularity: params.granularity,
    from: params.from,
    to: params.to,
    tz: String(tz),
    type: params.type,
  });
  const res = await fetch(`/api/analytics?${searchParams}`);
  if (!res.ok) throw new AnalyticsRequestError(responseErrorMessage(await res.json().catch(() => null)), res.status);
  return res.json();
};

/* ------------------------------------------------------------------ */
/*  Query hook                                                         */
/* ------------------------------------------------------------------ */

export function useAnalyticsQuery(params: AnalyticsParams, tz: number) {
  return useQuery({
    queryKey: analyticsKeys.query(params, tz),
    queryFn: () => fetchAnalytics(params, tz),
    retry: shouldRetryAnalyticsRequest,
  });
}
