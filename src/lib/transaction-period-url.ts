import { getCurrentMonth, type PeriodType } from "@/lib/analytics-period";
import { MAX_TRANSACTION_SEARCH_LENGTH } from "@/lib/transaction-filter-limits";

/** The period half of the ledger filters, as it travels in the address bar. */
export interface PeriodParams {
  period: PeriodType;
  from: string | null;
  to: string | null;
}

/**
 * Everything the address bar carries: the period, plus the narrowings a link
 * from elsewhere in the app can ask for.
 *
 * The page mirrors its filters here on every change, so this set has to include
 * anything an incoming link may set — otherwise the mirror writes the URL back
 * without them and the reader, seeing the URL change, takes them away again. An
 * analytics drill-down arriving with a category is exactly that case.
 *
 * The advanced filters (source, amount, sort) are deliberately absent. They are
 * not linkable, and the page absorbs its own writes rather than re-reading them,
 * so they survive in local state.
 */
export interface FilterParams extends PeriodParams {
  type: "ALL" | "INCOME" | "EXPENSE";
  categoryId: string | null;
  labelId: string | null;
  search: string;
  /**
   * Where the visitor came from, as an opaque query string for that page.
   *
   * It lives here rather than beside the return bar that reads it because the page
   * mirrors its filters through `filterSearchParams` on every change, and that
   * function writes a fixed set and drops the rest. A param the serializer does
   * not know about survives until the first mirror write and then vanishes while
   * the user is still on the page — which is exactly how #284's mirror erased the
   * `categoryId` a drill-down had arrived with. Round-tripping it here is what
   * keeps the back button alive through a filter edit.
   *
   * Opaque on purpose: nothing in this module interprets it. `analyticsReturnHref`
   * validates it against a literal path, so it can never become an off-site href.
   */
  ret: string | null;
}

/** Mirrors the `.max(100)` on `categoryId` / `labelId` in `transactionFilterFields`. */
const MAX_FILTER_ID_LENGTH = 100;

/** An id the API would refuse is not worth holding: it 400s every request. */
const asFilterId = (value: string | null) =>
  value && value.length <= MAX_FILTER_ID_LENGTH ? value : null;

/** Long enough for the handful of params a return blob holds, short enough that a
 *  crafted one cannot bloat every URL this page writes. */
const MAX_RETURN_LENGTH = 200;

const asType = (value: string | null): FilterParams["type"] =>
  value === "INCOME" || value === "EXPENSE" ? value : "ALL";

const PERIOD_TYPES: readonly PeriodType[] = ["all", "custom", "weekly", "monthly", "yearly"];

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Reject a well-formed string that is not a real day, such as 2026-02-30. */
const isCalendarDay = (value: string): boolean => {
  if (!DAY_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

/**
 * Read the period out of the URL, falling back to the account's current month.
 *
 * A link is user-supplied input, and a bad one must not be able to leave the page
 * in a state the filter schema rejects: that would be a 400 on every request the
 * page makes, which the user cannot clear without editing the address bar. So the
 * rules here mirror the server's exactly, and anything inconsistent is discarded
 * whole rather than repaired a field at a time — a half-trusted range is how you
 * end up showing one window while the URL claims another.
 */
export const parsePeriodParams = (
  params: URLSearchParams,
  tzOffset: number,
): PeriodParams => {
  const fallback = (): PeriodParams => ({ period: "monthly", ...getCurrentMonth(tzOffset) });

  const period = params.get("period");
  if (!period || !PERIOD_TYPES.includes(period as PeriodType)) return fallback();

  const from = params.get("from");
  const to = params.get("to");

  if (period === "all") {
    // Bounds alongside All time are the contradiction the schema refuses.
    return from || to ? fallback() : { period: "all", from: null, to: null };
  }

  if (!from || !to) return fallback();
  if (!isCalendarDay(from) || !isCalendarDay(to)) return fallback();
  if (from > to) return fallback();

  return { period: period as PeriodType, from, to };
};

/**
 * Read every filter the address bar carries, period included.
 *
 * Anything absent or malformed falls back to its default rather than reaching the
 * API, since a link is user-supplied input and a 400 on every request is a state
 * the user cannot clear without editing the address bar.
 */
export const parseFilterParams = (
  params: URLSearchParams,
  tzOffset: number,
): FilterParams => ({
  ...parsePeriodParams(params, tzOffset),
  type: asType(params.get("type")),
  categoryId: asFilterId(params.get("categoryId")),
  labelId: asFilterId(params.get("labelId")),
  search: (params.get("search") ?? "").slice(0, MAX_TRANSACTION_SEARCH_LENGTH),
  ret: params.get("ret")?.slice(0, MAX_RETURN_LENGTH) || null,
});

/**
 * Serialize the filters for the address bar.
 *
 * Takes a partial so the analytics drill-down can build a link from what a
 * breakdown row knows — a category and a window, no more — through the same
 * function the page mirrors itself with. One place names these params, so the
 * writer cannot emit a set the reader does not take back.
 */
export const filterSearchParams = (filters: Partial<FilterParams>): string => {
  const params = new URLSearchParams();
  if (filters.period) params.set("period", filters.period);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.type && filters.type !== "ALL") params.set("type", filters.type);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.labelId) params.set("labelId", filters.labelId);
  if (filters.search) params.set("search", filters.search);
  if (filters.ret) params.set("ret", filters.ret);
  return params.toString();
};

