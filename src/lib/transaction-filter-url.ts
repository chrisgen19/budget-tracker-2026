import type { TransactionFilters } from "@/components/transactions/transaction-filters";
import { accountMonthKey, isCalendarDay } from "@/lib/account-time";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";

/**
 * What a breakdown row knows about itself: which slice of the data produced the
 * number the user just tapped. Every drill-down surface — category rows, donut
 * slices, label bars, heatmap days — describes itself in these terms and nothing
 * else, so they cannot drift apart in how they narrow the list.
 */
export interface TransactionDrillDown {
  type?: TransactionFilters["type"];
  categoryId?: string | null;
  labelId?: string | null;
  /** Inclusive calendar days. A single day passes the same value to both. */
  dateFrom?: string | null;
  dateTo?: string | null;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Mirrors the `.max(100)` on `categoryId` / `labelId` in `transactionFilterSchema`. */
const MAX_FILTER_ID_LENGTH = 100;

/**
 * Only the params the transactions list is willing to be steered by. The same
 * predicate the API validates with, so a day this lets through cannot be one the
 * request is then rejected for.
 */
const asDay = (value: string | null | undefined) =>
  value && isCalendarDay(value) ? value : null;

/** Both ends present, both real days, and the wrong way round. */
const isReversed = (from: string | null | undefined, to: string | null | undefined) => {
  const start = asDay(from);
  const end = asDay(to);
  return start !== null && end !== null && start > end;
};

/**
 * Build the `/transactions` href behind a breakdown row.
 *
 * The param names are the ones `GET /api/transactions` already accepts, so a
 * hand-written URL behaves exactly like a clicked one, and this module is the
 * single place that names them — `readTransactionFilters` below reads back
 * whatever this writes.
 */
export function buildTransactionsHref(drillDown: TransactionDrillDown): string {
  const params = new URLSearchParams();
  if (drillDown.type && drillDown.type !== "ALL") params.set("type", drillDown.type);
  if (drillDown.categoryId) params.set("categoryId", drillDown.categoryId);
  if (drillDown.labelId) params.set("labelId", drillDown.labelId);
  const reversed = isReversed(drillDown.dateFrom, drillDown.dateTo);
  const from = reversed ? null : asDay(drillDown.dateFrom);
  const to = reversed ? null : asDay(drillDown.dateTo);
  if (from) params.set("dateFrom", from);
  if (to) params.set("dateTo", to);

  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

/** True when the query string carries at least one filter worth honouring. */
export function hasTransactionFilterParams(params: URLSearchParams): boolean {
  return (
    params.has("type") ||
    params.has("categoryId") ||
    params.has("labelId") ||
    params.has("dateFrom") ||
    params.has("dateTo") ||
    params.has("month") ||
    params.has("search")
  );
}

/**
 * The API caps an id at 100 characters. Holding a longer one would leave every
 * request failing with a 400 and no way out but editing the URL, so a URL that
 * carries one is read as carrying no id at all.
 */
const asFilterId = (value: string | null) =>
  value && value.length <= MAX_FILTER_ID_LENGTH ? value : null;

const asType = (value: string | null): TransactionFilters["type"] =>
  value === "INCOME" || value === "EXPENSE" ? value : "ALL";

/**
 * Read a link's params into a full filter set, falling back to the defaults for
 * anything absent or malformed. A URL is user-editable input, so an unparseable
 * value is dropped rather than allowed to reach the API and 400 there.
 *
 * A date range and a month cannot both apply (the server treats the range as a
 * replacement), so an incoming range clears the month.
 */
export function readTransactionFilters(
  params: URLSearchParams,
  timezoneOffset: number,
): TransactionFilters {
  // A reversed range is refused by the API, and holding one in local state would
  // leave every request failing until the chip is cleared by hand. Dropping both
  // ends lands on the ordinary month instead.
  const reversed = isReversed(params.get("dateFrom"), params.get("dateTo"));
  const dateFrom = reversed ? null : asDay(params.get("dateFrom"));
  const dateTo = reversed ? null : asDay(params.get("dateTo"));
  const month = params.get("month");
  const hasRange = Boolean(dateFrom || dateTo);

  return {
    search: (params.get("search") ?? "").slice(0, MAX_TRANSACTION_SEARCH_LENGTH),
    type: asType(params.get("type")),
    month: hasRange
      ? "ALL"
      : month === "ALL" || (month && MONTH_PATTERN.test(month))
        ? month
        : accountMonthKey(new Date(), timezoneOffset),
    categoryId: asFilterId(params.get("categoryId")),
    labelId: asFilterId(params.get("labelId")),
    dateFrom,
    dateTo,
    createdVia: "ALL",
    amountMin: null,
    amountMax: null,
    sortBy: "date",
    sortDir: "desc",
  };
}
