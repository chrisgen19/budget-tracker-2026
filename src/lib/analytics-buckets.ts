import type { AnalyticsGranularity } from "@/types";

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Convert a UTC date to a bucket key based on granularity (in user's local timezone). */
export const toBucketKey = (date: Date, granularity: AnalyticsGranularity, tzMs: number): string => {
  const local = new Date(date.getTime() - tzMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  if (granularity === "yearly") return `${y}`;
  if (granularity === "monthly") return `${y}-${String(m + 1).padStart(2, "0")}`;

  // Weekly: find Monday of the week
  const dayOfWeek = local.getUTCDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(Date.UTC(y, m, d + mondayOffset));
  const mY = monday.getUTCFullYear();
  const mM = monday.getUTCMonth();
  const mD = monday.getUTCDate();
  return `${mY}-${String(mM + 1).padStart(2, "0")}-${String(mD).padStart(2, "0")}`;
};

/** Generate a human-readable label for a bucket key. Clamps weekly labels to rangeFrom/rangeTo. */
export const toBucketLabel = (key: string, granularity: AnalyticsGranularity, rangeFrom?: Date, rangeTo?: Date): string => {
  if (granularity === "yearly") return key;

  if (granularity === "monthly") {
    const [y, m] = key.split("-").map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }

  // Weekly: show clamped date range
  const [y, m, d] = key.split("-").map(Number);
  let start = new Date(Date.UTC(y, m - 1, d));
  let end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

  if (rangeFrom && start < rangeFrom) start = rangeFrom;
  if (rangeTo && end > rangeTo) end = rangeTo;

  const sLabel = `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const eLabel = start.getUTCMonth() === end.getUTCMonth()
    ? `${end.getUTCDate()}`
    : `${MONTH_NAMES[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${sLabel}–${eLabel}`;
};

/** Generate all expected bucket keys between from and to dates. */
export const generateBucketKeys = (from: Date, to: Date, granularity: AnalyticsGranularity, tzMs: number): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(from.getTime());

  const stepMs = granularity === "weekly" ? 24 * 60 * 60 * 1000 : 0;

  while (cursor <= to) {
    const key = toBucketKey(cursor, granularity, tzMs);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }

    if (granularity === "yearly") {
      cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
      cursor.setUTCMonth(0, 1);
    } else if (granularity === "monthly") {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    } else {
      cursor.setTime(cursor.getTime() + stepMs);
    }
  }

  return keys;
};
