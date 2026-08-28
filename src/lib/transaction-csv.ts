import { accountDateKey, toAccountWallClock } from "@/lib/account-time";
import type { TransactionWithCategory } from "@/types";

type CsvTransaction = Pick<
  TransactionWithCategory,
  "amount" | "date" | "description" | "type"
> & { category: Pick<TransactionWithCategory["category"], "name"> };

const formatCsvDate = (date: Date | string, timezoneOffset: number) => {
  const [year, month, day] = accountDateKey(date, timezoneOffset).split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
};

const formatCsvTime = (date: Date | string, timezoneOffset: number) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(toAccountWallClock(date, timezoneOffset));

/** Generate a CSV using the same saved account timezone as the transactions page. */
export const generateTransactionsCsv = (
  transactions: CsvTransaction[],
  timezoneOffset: number,
): string => {
  const header = ["Date", "Time", "Description", "Category", "Type", "Amount"];
  const rows = transactions.map((tx) => [
    formatCsvDate(tx.date, timezoneOffset),
    formatCsvTime(tx.date, timezoneOffset),
    `"${tx.description.replace(/"/g, '""')}"`,
    `"${tx.category.name.replace(/"/g, '""')}"`,
    tx.type,
    tx.type === "INCOME" ? tx.amount : -tx.amount,
  ]);
  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
};
