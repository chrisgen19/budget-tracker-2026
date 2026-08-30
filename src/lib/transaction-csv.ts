import { accountDateKey, toAccountWallClock } from "@/lib/account-time";
import type { TransactionWithCategory } from "@/types";

type CsvTransaction = Pick<
  TransactionWithCategory,
  "amount" | "date" | "description" | "type" | "createdVia" | "receiptGroupId"
> & {
  category: Pick<TransactionWithCategory["category"], "name">;
  labels?: Array<{ label: { name: string } }>;
  bill?: { description: string } | null;
};

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

/** Spreadsheet programs can execute quoted cells beginning with these characters. */
const neutralizeFormula = (value: string) =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

const quoteCsv = (value: string) =>
  `"${neutralizeFormula(value).replace(/"/g, '""')}"`;

/** Generate a CSV using the same saved account timezone as the transactions page. */
export const generateTransactionsCsv = (
  transactions: CsvTransaction[],
  timezoneOffset: number,
): string => {
  const header = [
    "Date",
    "Time",
    "Description",
    "Category",
    "Labels",
    "Type",
    "Amount",
    "Source",
    "Receipt",
    "Bill",
  ];
  const rows = transactions.map((tx) => [
    formatCsvDate(tx.date, timezoneOffset),
    formatCsvTime(tx.date, timezoneOffset),
    quoteCsv(tx.description),
    quoteCsv(tx.category.name),
    quoteCsv(tx.labels?.map(({ label }) => label.name).join("; ") ?? ""),
    tx.type,
    tx.type === "INCOME" ? tx.amount : -tx.amount,
    tx.createdVia,
    tx.receiptGroupId ? "Yes" : "No",
    quoteCsv(tx.bill?.description ?? ""),
  ]);
  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
};
