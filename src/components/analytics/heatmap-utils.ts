import type { AnalyticsDailyItem } from "@/types";
import { MONTH_NAMES } from "@/lib/analytics-buckets";

export type HeatmapMode = "calendar" | "weeks" | "weekday";

/** Intensity step (0-4) → Tailwind background class. */
export const INTENSITY_CLASSES = ["bg-cream-100", "bg-amber-100", "bg-amber-200", "bg-amber-300", "bg-amber-500"];

/** Pick a rendering mode from the number of days in range. */
export const heatmapMode = (days: number): HeatmapMode =>
  days <= 42 ? "calendar" : days <= 370 ? "weeks" : "weekday";

/** Day of week (0=Mon..6=Sun) from "YYYY-MM-DD" parsed as date parts (never as a UTC string). */
export const dayOfWeek = (dateStr: string): number => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=Sun
  return dow === 0 ? 6 : dow - 1;
};

/** "YYYY-MM-DD" → "Apr 12" / "Apr 12, 2026" */
export const formatDayLabel = (dateStr: string, withYear = false): string => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const label = `${MONTH_NAMES[m - 1]} ${d}`;
  return withYear ? `${label}, ${y}` : label;
};

/** Month (0-11) of a "YYYY-MM-DD" string. */
export const monthOf = (dateStr: string): number => Number(dateStr.split("-")[1]) - 1;

/** Group dense daily data into Mon–Sun weeks (nulls pad the first/last week). */
export const groupIntoWeeks = (data: AnalyticsDailyItem[]): (AnalyticsDailyItem | null)[][] => {
  const weeks: (AnalyticsDailyItem | null)[][] = [];
  let week: (AnalyticsDailyItem | null)[] = [];
  if (data.length > 0) {
    for (let i = 0; i < dayOfWeek(data[0].date); i++) week.push(null);
  }
  for (const day of data) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
};

/** Quantile-based 5-step intensity (0 = no spend) so one outlier day doesn't wash out the scale. */
export const intensityScale = (values: number[]): ((v: number) => number) => {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return () => 0;
  const q = (p: number) => positive[Math.min(positive.length - 1, Math.floor(p * positive.length))];
  const thresholds = [q(0.25), q(0.5), q(0.75)];
  return (v: number) => {
    if (v <= 0) return 0;
    if (v <= thresholds[0]) return 1;
    if (v <= thresholds[1]) return 2;
    if (v <= thresholds[2]) return 3;
    return 4;
  };
};

/** Per-weekday expense totals and averages (index 0=Mon..6=Sun). */
export const weekdayAverages = (data: AnalyticsDailyItem[]): { total: number; count: number; avg: number }[] => {
  const acc = Array.from({ length: 7 }, () => ({ total: 0, count: 0, avg: 0 }));
  for (const day of data) {
    const slot = acc[dayOfWeek(day.date)];
    slot.total += day.expenses;
    slot.count += 1;
  }
  for (const slot of acc) slot.avg = slot.count > 0 ? slot.total / slot.count : 0;
  return acc;
};
