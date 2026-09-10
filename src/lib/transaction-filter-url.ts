import { filterSearchParams } from "@/lib/transaction-period-url";
import { validDateString } from "@/lib/validations";

/**
 * What a breakdown row knows about itself: which slice of the data produced the
 * number the user just tapped. Every drill-down surface — category rows, label
 * bars, heatmap days — describes itself in these terms and nothing else, so they
 * cannot drift apart in how they narrow the list.
 */
export interface TransactionDrillDown {
  type?: "ALL" | "INCOME" | "EXPENSE";
  categoryId?: string | null;
  labelId?: string | null;
  /** Inclusive calendar days. A single day passes the same value to both. */
  from?: string | null;
  to?: string | null;
  /**
   * The view to offer as a way back, as a query string for `/analytics`.
   *
   * It travels separately from the window above, and has to: for a category or
   * label row the two agree, but a heatmap day filters the ledger to one day while
   * the period to return to is the whole analytics span. A computed href could not
   * tell those apart.
   */
  ret?: string | null;
}

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
 * A link that cannot describe a whole window therefore describes none, and the
 * page falls back to its ordinary current month.
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
 * Serialized by `filterSearchParams`, the same function the ledger mirrors its
 * own filters with, so a link cannot carry a param the page would then drop —
 * and a hand-written URL behaves exactly like a clicked one.
 */
export function buildTransactionsHref(drillDown: TransactionDrillDown): string {
  const window = asWindow(drillDown.from, drillDown.to);
  const query = filterSearchParams({
    type: drillDown.type,
    categoryId: drillDown.categoryId,
    labelId: drillDown.labelId,
    ret: drillDown.ret,
    // "custom" rather than the analytics period's own name: what reaches the list
    // is a pair of days, and calling it "monthly" would invite a later reader to
    // recompute the window from a month it no longer knows.
    ...(window ? { period: "custom" as const, ...window } : {}),
  });
  return query ? `/transactions?${query}` : "/transactions";
}
