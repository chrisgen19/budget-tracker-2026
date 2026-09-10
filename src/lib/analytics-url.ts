import {
  formatPeriodLabel,
  getCurrentMonth,
  type PeriodSelection,
} from "@/lib/analytics-period";
import { parsePeriodParams } from "@/lib/transaction-period-url";
import type { AnalyticsTypeFilter } from "@/types";

/** The analytics tabs, in the order the tab bar presents them. */
export const ANALYTICS_TAB_IDS = ["reports", "statistics", "health", "ai-assessment"] as const;

export type AnalyticsTab = (typeof ANALYTICS_TAB_IDS)[number];

/** Everything about the analytics view worth surviving a navigation. */
export interface AnalyticsUrlState {
  period: PeriodSelection;
  type: AnalyticsTypeFilter;
  tab: AnalyticsTab;
}

/**
 * How much of a return blob we are willing to read.
 *
 * It only ever holds five short params, so anything longer is not a link this app
 * wrote. Capping it keeps a crafted URL from making the reader do real work.
 */
const MAX_RETURN_PARAM_LENGTH = 200;

const asType = (value: string | null): AnalyticsTypeFilter =>
  value === "INCOME" || value === "EXPENSE" || value === "ALL" ? value : "EXPENSE";

const asTab = (value: string | null): AnalyticsTab =>
  ANALYTICS_TAB_IDS.includes(value as AnalyticsTab) ? (value as AnalyticsTab) : "reports";

/**
 * Read the analytics view out of a query string.
 *
 * The period half is `parsePeriodParams`, the ledger's own reader, so the two
 * pages validate a window by exactly one set of rules — a calendar-day check, both
 * bounds or neither, never backwards, and the account's current month when any of
 * that fails. The one difference is All time: every analytics chart needs a
 * bounded window (`/api/analytics` requires `from` and `to`, and the picker is
 * mounted with `allowAllTime` false), so an unbounded period falls back rather
 * than being honoured.
 *
 * The type defaults to EXPENSE, matching the Breakdowns card's own default — a
 * URL with no type should land where a fresh visit lands, not somewhere else.
 */
export function parseAnalyticsParams(
  params: URLSearchParams,
  tzOffset: number,
): AnalyticsUrlState {
  const { period, from, to } = parsePeriodParams(params, tzOffset);
  const bounded =
    period === "all" || from === null || to === null
      ? { periodType: "monthly" as const, ...getCurrentMonth(tzOffset) }
      : { periodType: period, from, to };

  return {
    period: bounded,
    type: asType(params.get("type")),
    tab: asTab(params.get("tab")),
  };
}

/** Serialize the analytics view for the address bar. Defaults are still written,
 *  since this string is also what a return link carries and a missing value there
 *  would be indistinguishable from a link that predates the param. */
export function analyticsSearchParams({ period, type, tab }: AnalyticsUrlState): string {
  return new URLSearchParams({
    period: period.periodType,
    from: period.from,
    to: period.to,
    type,
    tab,
  }).toString();
}

/** Where a return link goes, and the view it goes to, named. */
export interface AnalyticsReturnTarget {
  href: string;
  /** The destination period, e.g. "Jul 1 – Sep 30, 2026". */
  periodLabel: string;
}

/**
 * Resolve a return blob into a link, or null when there is nothing trustworthy to
 * return to.
 *
 * The blob is a query string, never a URL: the path is a literal here, so no
 * caller-supplied value can send the user off-site. Everything inside it goes
 * through `parseAnalyticsParams` and comes back out through
 * `analyticsSearchParams`, so what the link carries is what this app can express
 * — a crafted blob is narrowed to a valid view rather than rejected outright,
 * which is the right trade for a back button.
 *
 * The label comes back with the href, from the same parse, because they describe
 * the same thing and a caller holding only the href has no way to name it without
 * guessing. A drill-down from a heatmap day is where guessing goes wrong: the
 * ledger is filtered to that one day while this link returns to the whole analytics
 * span, so a label built from the page's own filters would name a period the link
 * does not go to.
 */
export function analyticsReturnTarget(
  blob: string | null,
  tzOffset: number,
): AnalyticsReturnTarget | null {
  if (!blob || blob.length > MAX_RETURN_PARAM_LENGTH) return null;
  const state = parseAnalyticsParams(new URLSearchParams(blob), tzOffset);
  return {
    href: `/analytics?${analyticsSearchParams(state)}`,
    periodLabel: formatPeriodLabel(state.period.periodType, state.period.from, state.period.to),
  };
}
