import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";
import { validDateString } from "@/lib/validations";

/**
 * The filter fields a caller may send.
 *
 * Kept as a bare object schema because Zod 3's `.superRefine` returns a
 * `ZodEffects`, which cannot be narrowed further — `transaction-bulk.ts` needs to
 * `.omit()` the timezone from it. The refined schemas below are what callers parse.
 */
export const transactionFilterFields = z.object({
  search: z.string().max(MAX_TRANSACTION_SEARCH_LENGTH).default(""),
  type: z.enum(["ALL", "INCOME", "EXPENSE"]).default("ALL"),
  /**
   * The selected period. `null` means the caller predates the period filter, in
   * which case `month` is authoritative; anything other than "all" must arrive
   * with both `from` and `to`.
   */
  period: z.enum(["all", "custom", "weekly", "monthly", "yearly"]).nullable().default(null),
  from: validDateString.nullable().default(null),
  to: validDateString.nullable().default(null),
  /** Legacy single-month window, still honored so older clients keep working. */
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

type PeriodFields = Pick<z.infer<typeof transactionFilterFields>, "period" | "from" | "to">;

/**
 * Reject a period that does not fully describe its own window.
 *
 * A half-specified range is the dangerous case rather than a cosmetic one:
 * `/api/transactions/selection` materializes bulk edit and delete targets from
 * exactly these filters, so a bound that went missing in transit would silently
 * widen an operation from the week the user was looking at to everything ever
 * recorded. Failing the request is the only safe reading.
 */
const checkPeriod = (filters: PeriodFields, ctx: z.RefinementCtx) => {
  const { period, from, to } = filters;

  if ((from === null) !== (to === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "from and to must be provided together",
      path: [from === null ? "from" : "to"],
    });
    return;
  }

  if (from !== null && to !== null && from > to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "from must not be after to",
      path: ["from"],
    });
    return;
  }

  if (period !== null && period !== "all" && from === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `a ${period} period requires from and to`,
      path: ["from"],
    });
  }
};

/** Server-side filters, including the timezone the window is resolved in. */
export const transactionFilterSchema = transactionFilterFields.superRefine(checkPeriod);

/** The client's half of a selection snapshot, which carries its timezone separately. */
export const clientTransactionFilterSchema = transactionFilterFields
  .omit({ timezoneOffset: true })
  .superRefine(checkPeriod);

export type NormalizedTransactionFilters = z.infer<typeof transactionFilterSchema>;

const optionalNumber = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  return Number(value);
};

/** Absent and blank both mean "not set" — `?from=` must not fail date validation. */
const optionalString = (value: string | null) => {
  if (value === null || value.trim() === "") return null;
  return value;
};

/** Parse the public list query into the same normalized shape used by bulk endpoints. */
export function parseTransactionSearchParams(searchParams: URLSearchParams) {
  return transactionFilterSchema.parse({
    search: searchParams.get("search") ?? "",
    type: searchParams.get("type") ?? "ALL",
    period: optionalString(searchParams.get("period")),
    from: optionalString(searchParams.get("from")),
    to: optionalString(searchParams.get("to")),
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

/**
 * Resolve the filters to a date window, or `undefined` for no date clause.
 *
 * Precedence: an explicit day range wins, then the legacy `month`. A caller that
 * says `period: "all"` clears the window even if a stale `month` is still in its
 * payload, so the two can never disagree about what the user is looking at.
 *
 * Boundaries use the one formula the app uses everywhere — `Date.UTC(y, m, d) +
 * tzOffset * 60000` — so a window matches the calendar days the user sees.
 */
const dateWindow = (
  filters: NormalizedTransactionFilters,
): Prisma.DateTimeFilter | undefined => {
  const timezoneMs = filters.timezoneOffset * 60 * 1000;

  if (filters.from !== null && filters.to !== null) {
    const [fromYear, fromMonth, fromDay] = filters.from.split("-").map(Number);
    const [toYear, toMonth, toDay] = filters.to.split("-").map(Number);
    return {
      gte: new Date(Date.UTC(fromYear, fromMonth - 1, fromDay) + timezoneMs),
      // Exclusive, on the day after `to`, so the whole of the final day counts.
      lt: new Date(Date.UTC(toYear, toMonth - 1, toDay + 1) + timezoneMs),
    };
  }

  if (filters.period === "all") return undefined;

  if (filters.month !== "ALL") {
    const [year, month] = filters.month.split("-").map(Number);
    return {
      gte: new Date(Date.UTC(year, month - 1, 1) + timezoneMs),
      lt: new Date(Date.UTC(year, month, 1) + timezoneMs),
    };
  }

  return undefined;
};

export function buildTransactionWhere(
  userId: string,
  filters: NormalizedTransactionFilters,
): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { userId };

  if (filters.type !== "ALL") where.type = filters.type;

  const date = dateWindow(filters);
  if (date) where.date = date;

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
