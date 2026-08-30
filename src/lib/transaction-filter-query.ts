import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";

export const transactionFilterSchema = z.object({
  search: z.string().max(MAX_TRANSACTION_SEARCH_LENGTH).default(""),
  type: z.enum(["ALL", "INCOME", "EXPENSE"]).default("ALL"),
  month: z.union([z.literal("ALL"), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]).default("ALL"),
  categoryId: z.string().min(1).max(100).nullable().default(null),
  labelId: z.string().min(1).max(100).nullable().default(null),
  createdVia: z.enum(["ALL", "APP", "MCP", "TELEGRAM"]).default("ALL"),
  amountMin: z.number().finite().nonnegative().nullable().default(null),
  amountMax: z.number().finite().nonnegative().nullable().default(null),
  sortBy: z.enum(["date", "amount"]).default("date"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  timezoneOffset: z.number().int().min(-840).max(840).default(0),
});

export type NormalizedTransactionFilters = z.infer<typeof transactionFilterSchema>;

const optionalNumber = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  return Number(value);
};

/** Parse the public list query into the same normalized shape used by bulk endpoints. */
export function parseTransactionSearchParams(searchParams: URLSearchParams) {
  return transactionFilterSchema.parse({
    search: searchParams.get("search") ?? "",
    type: searchParams.get("type") ?? "ALL",
    month: searchParams.get("month") ?? "ALL",
    categoryId: searchParams.get("categoryId"),
    labelId: searchParams.get("labelId"),
    createdVia: searchParams.get("createdVia") ?? "ALL",
    amountMin: optionalNumber(searchParams.get("amountMin")),
    amountMax: optionalNumber(searchParams.get("amountMax")),
    sortBy: searchParams.get("sortBy") ?? "date",
    sortDir: searchParams.get("sortDir") ?? "desc",
    timezoneOffset: optionalNumber(searchParams.get("tz")) ?? 0,
  });
}
export function buildTransactionWhere(
  userId: string,
  filters: NormalizedTransactionFilters,
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { userId };

  if (filters.type !== "ALL") where.type = filters.type;

  if (filters.month !== "ALL") {
    const [year, month] = filters.month.split("-").map(Number);
    const timezoneMs = filters.timezoneOffset * 60 * 1000;
    where.date = {
      gte: new Date(Date.UTC(year, month - 1, 1) + timezoneMs),
      lt: new Date(Date.UTC(year, month, 1) + timezoneMs),
    };
  }

  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.labelId) where.labels = { some: { labelId: filters.labelId } };
  if (filters.createdVia !== "ALL") where.createdVia = filters.createdVia;

  if (filters.amountMin !== null || filters.amountMax !== null) {
    where.amount = {
      ...(filters.amountMin !== null ? { gte: filters.amountMin } : {}),
      ...(filters.amountMax !== null ? { lte: filters.amountMax } : {}),
    };
  }

  if (filters.search) {
    where.description = { contains: filters.search, mode: "insensitive" };
  }

  return where;
}

export function buildTransactionOrderBy(
  filters: NormalizedTransactionFilters,
): Prisma.TransactionOrderByWithRelationInput[] {
  const direction = filters.sortDir;
  return filters.sortBy === "amount"
    ? [{ amount: direction }, { date: "desc" }, { id: "asc" }]
    : [{ date: direction }, { createdAt: "desc" }, { id: "asc" }];
}
