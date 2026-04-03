import type { TransactionWithCategory } from "@/types";

export interface DateGroup {
  dateKey: string;
  dateLabel: string;
  transactions: TransactionWithCategory[];
  subtotal: number;
}

/** Format date key from a Date: "2026-02-18" */
export const toDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "2026-02-18" → "February 18, 2026" */
export const formatDateLabel = (key: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(key + "T00:00:00"));

/** Date object → "3:27 PM" */
export const formatTime = (date: string | Date) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));

/** Group transactions by date, sorted most recent first */
export const groupByDate = (transactions: TransactionWithCategory[]): DateGroup[] => {
  const map = new Map<string, TransactionWithCategory[]>();

  for (const tx of transactions) {
    const key = toDateKey(new Date(tx.date));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tx);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, txs]) => ({
      dateKey: key,
      dateLabel: formatDateLabel(key),
      transactions: txs,
      subtotal: txs.reduce(
        (sum, t) => sum + (t.type === "INCOME" ? t.amount : -t.amount),
        0
      ),
    }));
};
