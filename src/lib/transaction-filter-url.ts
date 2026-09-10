import type { TransactionFilters } from "@/components/transactions/transaction-filters";
import { accountMonthKey } from "@/lib/account-time";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";
import { validDateString } from "@/lib/validations";

/**
 * What a breakdown row knows about itself: which slice of the data produced the
 * number the user just tapped. Every drill-down surface — category rows, label
 * bars, heatmap days — describes itself in these terms and nothing else, so they
 * cannot drift apart in how they narrow the list.
 */
export interface TransactionDrillDown {
  type?: TransactionFilters["type"];
  categoryId?: string | null;
  labelId?: string | null;
  /** Inclusive calendar days. A single day passes the same value to both. */
  from?: string | null;
  to?: string | null;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Mirrors the `.max(100)` on `categoryId` / `labelId` in `transactionFilterFields`. */
const MAX_FILTER_ID_LENGTH = 100;

/**
 * The same predicate the API validates with, so a day this lets through cannot
 * be one the request is then rejected for.
 */
const asDay = (value: string | null | undefined) =>
  value && validDateString.safeParse(value).success ? value : null;

/**
 * A window is all-or-nothing.
 *
 * `transactionFilterFields` refuses a half-specified or backwards range outright,
 * because `/api/transactions/selection` materialises bulk edit and delete targets
 * from these same filters and a bound lost in transit would widen the operation.
 * A link that cannot describe a whole window therefore describes none, rather
 * than sending half of one and having every request fail.
 */
const asWindow = (from: string | null | undefined, to: string | null | undefined) => {
  const start = asDay(from);
  const end = asDay(to);
  if (start === null || end === null || start > end) return null;
  return { from: start, to: end };
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

  const window = asWindow(drillDown.from, drillDown.to);
  if (window) {
    // "custom" rather than the analytics period's own name: what reaches the list
    // is a pair of days, and calling it "monthly" would invite a later reader to
    // recompute the window from a month it no longer knows.
    params.set("period", "custom");
    params.set("from", window.from);
    params.set("to", window.to);
  }

  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

/** True when the query string carries at least one filter worth honouring. */
export function hasTransactionFilterParams(params: URLSearchParams): boolean {
  return (
    params.has("type") ||
    params.has("categoryId") ||
    params.has("labelId") ||
    params.has("period") ||
    params.has("from") ||
    params.has("to") ||
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
 * A window and a month cannot both apply — the server resolves the window first
 * and `month` is the legacy path behind it — so an incoming window parks the
 * month at "ALL", and no window leaves `period` null so the month stays
 * authoritative.
 */
export function readTransactionFilters(
  params: URLSearchParams,
  timezoneOffset: number,
): TransactionFilters {
  const window = asWindow(params.get("from"), params.get("to"));
  const month = params.get("month");

  return {
    search: (params.get("search") ?? "").slice(0, MAX_TRANSACTION_SEARCH_LENGTH),
    type: asType(params.get("type")),
    period: window ? "custom" : null,
    from: window?.from ?? null,
    to: window?.to ?? null,
    month: window
      ? "ALL"
      : month === "ALL" || (month && MONTH_PATTERN.test(month))
        ? month
        : accountMonthKey(new Date(), timezoneOffset),
    categoryId: asFilterId(params.get("categoryId")),
    labelId: asFilterId(params.get("labelId")),
    createdVia: "ALL",
    amountMin: null,
    amountMax: null,
    sortBy: "date",
    sortDir: "desc",
  };
}
