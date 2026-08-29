import type { TransactionFilters } from "@/components/transactions/transaction-filters";

/** Sort presets offered in the filter dialog, and the source of the "Sort: …" chip label. */
export const SORT_OPTIONS = [
  { label: "Newest first", sortBy: "date" as const, sortDir: "desc" as const },
  { label: "Oldest first", sortBy: "date" as const, sortDir: "asc" as const },
  { label: "Highest amount", sortBy: "amount" as const, sortDir: "desc" as const },
  { label: "Lowest amount", sortBy: "amount" as const, sortDir: "asc" as const },
];

export const SOURCE_OPTIONS = [
  { value: "ALL" as const, label: "Any source" },
  { value: "APP" as const, label: "In app" },
  { value: "MCP" as const, label: "Claude" },
  { value: "TELEGRAM" as const, label: "Telegram" },
];

export const SOURCE_CHIP_LABELS: Record<Exclude<TransactionFilters["createdVia"], "ALL">, string> = {
  APP: "Source: In app",
  MCP: "Source: Claude",
  TELEGRAM: "Source: Telegram",
};

export const getSortLabel = (sortBy: TransactionFilters["sortBy"], sortDir: TransactionFilters["sortDir"]) =>
  SORT_OPTIONS.find((option) => option.sortBy === sortBy && option.sortDir === sortDir)?.label ??
  "Newest first";
