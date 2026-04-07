"use client";

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Time range picker skeleton */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="w-48 h-9 rounded-xl animate-shimmer" />
          <div className="w-20 h-9 rounded-lg animate-shimmer" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg animate-shimmer" />
          <div className="flex-1 h-5 rounded animate-shimmer" />
          <div className="w-8 h-8 rounded-lg animate-shimmer" />
        </div>
      </div>

      {/* Summary cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <div className="w-8 h-8 rounded-lg animate-shimmer" />
            <div className="w-16 h-3 rounded animate-shimmer" />
            <div className="w-24 h-6 rounded animate-shimmer" />
          </div>
        ))}
      </div>

      {/* Chart skeletons */}
      <div className="card p-5 space-y-3">
        <div className="w-40 h-5 rounded animate-shimmer" />
        <div className="w-24 h-3 rounded animate-shimmer" />
        <div className="h-[260px] rounded-xl animate-shimmer" />
      </div>

      <div className="card p-5 space-y-3">
        <div className="w-28 h-5 rounded animate-shimmer" />
        <div className="w-36 h-3 rounded animate-shimmer" />
        <div className="h-[260px] rounded-xl animate-shimmer" />
      </div>

      {/* Breakdown skeletons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3">
          <div className="w-40 h-5 rounded animate-shimmer" />
          <div className="h-[180px] rounded-full mx-auto w-[180px] animate-shimmer" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg animate-shimmer" />
                <div className="flex-1 h-4 rounded animate-shimmer" />
                <div className="w-16 h-4 rounded animate-shimmer" />
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5 space-y-3">
          <div className="w-36 h-5 rounded animate-shimmer" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-between">
                  <div className="w-24 h-4 rounded animate-shimmer" />
                  <div className="w-16 h-4 rounded animate-shimmer" />
                </div>
                <div className="h-2 rounded-full animate-shimmer" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
