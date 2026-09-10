import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { isCalendarDay } from "@/lib/account-time";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";

const daySchema = z
  .string()
  .refine(isCalendarDay, "Expected an existing calendar day, YYYY-MM-DD")
  .nullable()
  .default(null);

/**
 * The fields alone, unrefined. `transactionFilterSchema` below is what parses —
 * this exists because a cross-field refinement turns the schema into a
 * `ZodEffects`, which has no `.omit()`, and the bulk endpoints need to drop
 * `timezoneOffset` from the shape they accept in a request body.
 */
export const transactionFilterFields = z.object({
  search: z.string().max(MAX_TRANSACTION_SEARCH_LENGTH).default(""),
  type: z.enum(["ALL", "INCOME", "EXPENSE"]).default("ALL"),
  month: z.union([z.literal("ALL"), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]).default("ALL"),
  /**
   * An explicit calendar-day range, inclusive at both ends. Analytics works in
   * arbitrary periods ("last 90 days", one heatmap day) that `month` cannot
   * express, so a drill-down carries the range instead. Either end may stand
   * alone: `dateFrom` with no `dateTo` is everything since that day.
   */
  dateFrom: daySchema,
  dateTo: daySchema,
  categoryId: z.string().min(1).max(100).nullable().default(null),
  labelId: z.string().min(1).max(100).nullable().default(null),
  createdVia: z.enum(["ALL", "APP", "MCP", "TELEGRAM"]).default("ALL"),
  amountMin: z.number().finite().nonnegative().nullable().default(null),
  amountMax: z.number().finite().nonnegative().nullable().default(null),
  sortBy: z.enum(["date", "amount"]).default("date"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  timezoneOffset: z.number().int().min(-840).max(840).default(0),
});

export const transactionFilterSchema = transactionFilterFields.refine(
  // Independently valid ends can still contradict each other. Answering
  // "Sep 30 to Sep 2" with an empty list reads as "you spent nothing", which is a
  // lie about the data rather than a complaint about the request — and the bulk
  // selection endpoint shares this schema, where a malformed request quietly
  // matching zero rows looks like a successful one.
  (filters) => !filters.dateFrom || !filters.dateTo || filters.dateFrom <= filters.dateTo,
  { message: "dateFrom must not be after dateTo", path: ["dateFrom"] },
);

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
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
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
/**
 * Turn an inclusive `YYYY-MM-DD` range into the half-open instant window the
 * rows are stored in. Same formula as every other date boundary in the app:
 * `Date.UTC(y, m, d) + tzOffset * 60000`. `dateTo` is inclusive to the reader,
 * so the query ends at the *start of the next day* — anything else drops every
 * transaction logged after midnight on the last day.
 */
function buildDateRange(
  filters: NormalizedTransactionFilters,
): Prisma.DateTimeFilter | null {
  if (!filters.dateFrom && !filters.dateTo) return null;
  const timezoneMs = filters.timezoneOffset * 60 * 1000;
  const range: Prisma.DateTimeFilter = {};

  if (filters.dateFrom) {
    const [year, month, day] = filters.dateFrom.split("-").map(Number);
    range.gte = new Date(Date.UTC(year, month - 1, day) + timezoneMs);
  }
  if (filters.dateTo) {
    const [year, month, day] = filters.dateTo.split("-").map(Number);
    range.lt = new Date(Date.UTC(year, month - 1, day + 1) + timezoneMs);
  }

  return range;
}

export function buildTransactionWhere(
  userId: string,
  filters: NormalizedTransactionFilters,
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { userId };

  if (filters.type !== "ALL") where.type = filters.type;

  // A range and a month are alternatives, not layers: the range replaces the
  // month window rather than intersecting it, so a drill-down from a period
  // that straddles months can never land on a silently empty intersection.
  const range = buildDateRange(filters);
  if (range) {
    where.date = range;
  } else if (filters.month !== "ALL") {
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
