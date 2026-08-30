import { accountDateKey, toAccountWallClock } from "@/lib/account-time";
import { netDelta } from "@/lib/transfer-filters";
import type { TransactionWithCategory } from "@/types";

type CsvTransaction = Pick<
  TransactionWithCategory,
  "amount" | "date" | "description" | "type"
> & { category: Pick<TransactionWithCategory["category"], "name"> };

/** Signed for a spreadsheet: income positive, expense negative, a transfer 0. */
const signedCsvAmount = (tx: Pick<CsvTransaction, "type" | "amount">) => netDelta(tx);

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
    // A transfer moves money between the user's own accounts and nets to zero across the export,
    // so signing it like an expense would make a spreadsheet total the column and get a figure
    // that double-counts every credit-card bill payment.
    signedCsvAmount(tx),
  ]);
  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
};
