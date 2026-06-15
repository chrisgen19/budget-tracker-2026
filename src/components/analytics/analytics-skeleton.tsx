"use client";

/** Skeleton for the hero overview row (rendered above the tabs). */
export function AnalyticsHeroSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-pulse">
      <div className="card p-5 lg:p-6 lg:col-span-2 space-y-3">
        <div className="w-40 h-3 rounded animate-shimmer" />
        <div className="flex items-center gap-3">
          <div className="w-44 h-9 rounded animate-shimmer" />
          <div className="w-16 h-5 rounded-full animate-shimmer" />
        </div>
        <div className="h-14 rounded-xl animate-shimmer" />
      </div>
      <div className="card p-5 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl animate-shimmer" />
            <div className="flex-1 space-y-1.5">
              <div className="w-16 h-2.5 rounded animate-shimmer" />
              <div className="w-24 h-4 rounded animate-shimmer" />
            </div>
            <div className="w-12 h-5 rounded-full animate-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for the tab content (rendered below the tabs). */
export function AnalyticsContentSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Full-width chart */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl animate-shimmer" />
          <div className="space-y-1.5">
            <div className="w-28 h-4 rounded animate-shimmer" />
            <div className="w-40 h-3 rounded animate-shimmer" />
          </div>
        </div>
        <div className="h-[220px] sm:h-[280px] rounded-xl animate-shimmer" />
      </div>

      {/* Paired breakdown cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3">
          <div className="w-36 h-5 rounded animate-shimmer" />
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="h-[180px] w-[180px] rounded-full mx-auto sm:mx-0 animate-shimmer shrink-0" />
            <div className="flex-1 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg animate-shimmer" />
                  <div className="flex-1 h-4 rounded animate-shimmer" />
                  <div className="w-16 h-4 rounded animate-shimmer" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card p-5 space-y-3">
          <div className="w-36 h-5 rounded animate-shimmer" />
          <div className="h-[220px] rounded-xl animate-shimmer" />
        </div>
        <div className="card p-5 space-y-3">
          <div className="w-40 h-5 rounded animate-shimmer" />
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 28 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-md animate-shimmer" />
            ))}
          </div>
        </div>
        <div className="card p-5 space-y-3">
          <div className="w-40 h-5 rounded animate-shimmer" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl animate-shimmer" />
              <div className="flex-1 h-4 rounded animate-shimmer" />
              <div className="w-20 h-4 rounded animate-shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Full analytics skeleton (hero + content), kept for convenience. */
export function AnalyticsSkeleton() {
  return (
    <div className="space-y-4">
      <AnalyticsHeroSkeleton />
      <AnalyticsContentSkeleton />
    </div>
  );
}
