"use client";

import { AlertTriangle } from "lucide-react";

interface AnalyticsLoadErrorProps {
  error: Error | null;
  onRetry: () => void;
}

const isRangeError = (error: Error | null): boolean =>
  error?.message.startsWith("Date range") ?? false;

export function AnalyticsLoadError({ error, onRetry }: AnalyticsLoadErrorProps) {
  const rangeError = isRangeError(error);

  return (
    <div className="card p-8 flex flex-col items-center gap-3 text-center">
      <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
        <AlertTriangle className="w-6 h-6 text-red-400" />
      </div>
      <h3 className="font-serif text-lg text-warm-700">
        {rangeError ? "Choose a shorter date range" : "Failed to load analytics"}
      </h3>
      <p className="text-sm text-warm-400 max-w-sm">
        {rangeError
          ? `${error?.message}. Use the period picker above to choose a shorter range.`
          : "Something went wrong while fetching your data. Please try again."}
      </p>
      {!rangeError && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 min-h-11 px-4 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
