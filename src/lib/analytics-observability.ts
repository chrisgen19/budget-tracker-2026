export type AnalyticsRequestOutcome =
  | "success"
  | "unauthenticated"
  | "invalid_request"
  | "error";

export type AnalyticsRequestMetrics = {
  outcome: AnalyticsRequestOutcome;
  durationMs: number;
  databaseDurationMs?: number;
  fetchedRowCount?: number;
  bucketCount?: number;
  responseBytes?: number;
  errorCode?: "AUTH_REQUIRED" | "INVALID_QUERY" | "INTERNAL_ERROR";
};

const roundMilliseconds = (value: number): number =>
  Math.max(0, Math.round(value));

/**
 * Emits the allowlisted operational fields for one analytics request.
 *
 * The application does not persist or forward these records. Container log
 * collection is responsible for retention and deletion.
 */
export const logAnalyticsRequest = (metrics: AnalyticsRequestMetrics): void => {
  try {
    console.info(
      JSON.stringify({
        event: "analytics_request",
        outcome: metrics.outcome,
        durationMs: roundMilliseconds(metrics.durationMs),
        ...(metrics.databaseDurationMs === undefined
          ? {}
          : {
              databaseDurationMs: roundMilliseconds(metrics.databaseDurationMs),
            }),
        ...(metrics.fetchedRowCount === undefined
          ? {}
          : { fetchedRowCount: metrics.fetchedRowCount }),
        ...(metrics.bucketCount === undefined
          ? {}
          : { bucketCount: metrics.bucketCount }),
        ...(metrics.responseBytes === undefined
          ? {}
          : { responseBytes: metrics.responseBytes }),
        ...(metrics.errorCode === undefined
          ? {}
          : { errorCode: metrics.errorCode }),
      }),
    );
  } catch {
    // Observability must never change the request outcome.
  }
};
