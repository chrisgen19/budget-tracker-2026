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
