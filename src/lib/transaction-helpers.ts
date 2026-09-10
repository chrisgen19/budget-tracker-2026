import type { TransactionWithCategory } from "@/types";
import { accountDateKey, toAccountWallClock } from "@/lib/account-time";

export interface DateGroup {
  dateKey: string;
  dateLabel: string;
  dayNameFull: string;
  dayNameShort: string;
  transactions: TransactionWithCategory[];
  subtotal: number;
}

/** "2026-02-18" → "February 18, 2026" */
export const formatDateLabel = (key: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(key + "T00:00:00Z"));

/** "2026-02-18" → "Wednesday" */
export const formatDayNameFull = (key: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(key + "T00:00:00Z")
  );

/** "2026-02-18" → "Wed" */
export const formatDayNameShort = (key: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    new Date(key + "T00:00:00Z")
  );

const shortDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const shortDayWithYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const asUtcDay = (key: string) => new Date(key + "T00:00:00Z");

/**
 * Label an inclusive calendar-day range for the filter chip and the month button.
 *
 * The year is printed once when both ends share it ("Jan 15 – Mar 3, 2026") and on
 * both ends when they do not, since a range crossing New Year is exactly where a
 * single trailing year misleads. Either end may be absent: a drill-down can be
 * open at one side.
 */
export const formatFilterRangeLabel = (
  from: string | null,
  to: string | null,
): string => {
  if (from && to) {
    if (from === to) return shortDayWithYear.format(asUtcDay(from));
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    const start = sameYear ? shortDay.format(asUtcDay(from)) : shortDayWithYear.format(asUtcDay(from));
    return `${start} – ${shortDayWithYear.format(asUtcDay(to))}`;
  }
  if (from) return `From ${shortDayWithYear.format(asUtcDay(from))}`;
  if (to) return `Until ${shortDayWithYear.format(asUtcDay(to))}`;
  return "";
};

/** Instant → account-local "3:27 PM" */
export const formatTime = (date: string | Date, timezoneOffset: number) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(toAccountWallClock(date, timezoneOffset));

/** Group transactions by date, sorted most recent first */
export const groupByDate = (
  transactions: TransactionWithCategory[],
  timezoneOffset: number,
): DateGroup[] => {
  const map = new Map<string, TransactionWithCategory[]>();

  for (const tx of transactions) {
    const key = accountDateKey(tx.date, timezoneOffset);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tx);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, txs]) => ({
      dateKey: key,
      dateLabel: formatDateLabel(key),
      dayNameFull: formatDayNameFull(key),
      dayNameShort: formatDayNameShort(key),
      transactions: txs,
      subtotal: txs.reduce(
        (sum, t) => sum + (t.type === "INCOME" ? t.amount : -t.amount),
        0
      ),
    }));
};
