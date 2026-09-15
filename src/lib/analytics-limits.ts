import { daysBetweenCalendarDays, parseCalendarDay } from "@/lib/period-progress";
import type { AnalyticsGranularity } from "@/types";

/** The API returns dense daily data, so roughly ten years is the safe outer window. */
export const MAX_ANALYTICS_RANGE_DAYS = 3_660;

/** A chart larger than this is neither readable nor an appropriate API payload. */
export const MAX_ANALYTICS_BUCKETS = 260;

export const analyticsRangeDays = (from: string, to: string): number =>
  daysBetweenCalendarDays(from, to) + 1;

const mondayFor = (day: string): Date => {
  const date = parseCalendarDay(day);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date;
};

/** Count the same calendar buckets that `generateBucketKeys` would return. */
export const countAnalyticsBuckets = (
  from: string,
  to: string,
  granularity: AnalyticsGranularity,
): number => {
  const [fromYear, fromMonth] = from.slice(0, 7).split("-").map(Number);
  const [toYear, toMonth] = to.slice(0, 7).split("-").map(Number);

  if (granularity === "yearly") return toYear - fromYear + 1;
  if (granularity === "monthly") return (toYear - fromYear) * 12 + toMonth - fromMonth + 1;

  return Math.floor((mondayFor(to).getTime() - mondayFor(from).getTime()) / 604_800_000) + 1;
};
