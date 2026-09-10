import { getCurrentMonth, type PeriodType } from "@/lib/analytics-period";

/** The period half of the ledger filters, as it travels in the address bar. */
export interface PeriodParams {
  period: PeriodType;
  from: string | null;
  to: string | null;
}

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

/** Serialize the period for the address bar. */
export const periodSearchParams = ({ period, from, to }: PeriodParams): string => {
  const params = new URLSearchParams({ period });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params.toString();
};
