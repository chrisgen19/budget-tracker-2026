import type { AnalyticsGranularity } from "@/types";
import { MONTH_NAMES, MONTH_FULL } from "@/lib/analytics-buckets";

/**
 * A period the user can select.
 *
 * `"all"` is unbounded and carries no from/to. Only the transactions ledger
 * offers it — the analytics API requires a bounded window — so components take
 * an `allowAllTime` flag rather than branching on the page they render in.
 */
export type PeriodType = AnalyticsGranularity | "custom" | "all";

export interface DateRange {
  from: string;
  to: string;
}

/** A period type together with the days it currently resolves to. */
export interface PeriodSelection extends DateRange {
  periodType: PeriodType;
}

export const ALL_TIME_LABEL = "All time";

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, "0");

/** Format a date's UTC parts as YYYY-MM-DD. */
const fmtUTC = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Get "today" shifted into the user's saved timezone (read via UTC accessors). */
export const getLocalToday = (tzOffset: number): Date =>
  new Date(Date.now() - tzOffset * 60 * 1000);

/*
 * Every range below is built from UTC accessors deliberately. These are calendar
 * day keys, not instants: `new Date(y, m, d)` resolves them against the *browser's*
 * zone, so a user whose account is UTC+8 sitting at a machine set to UTC-7 would
 * get week and month boundaries a day away from the ones `buildTransactionWhere`
 * applies against `users.timezone_offset`. Day keys also sort lexicographically,
 * so a string compare between two of them is a date compare.
 */

/** The calendar month containing `monthIndex` (0-based; out of range rolls the year). */
export const monthRange = (year: number, monthIndex: number): DateRange => ({
  from: fmtUTC(new Date(Date.UTC(year, monthIndex, 1))),
  to: fmtUTC(new Date(Date.UTC(year, monthIndex + 1, 0))),
});

/** The whole calendar year. */
export const yearRange = (year: number): DateRange => ({
  from: `${year}-01-01`,
  to: `${year}-12-31`,
});

/** The Monday-to-Sunday week containing `dayKey`. */
export const weekRange = (dayKey: string): DateRange => {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const toMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return {
    from: fmtUTC(new Date(Date.UTC(y, m - 1, d + toMonday))),
    to: fmtUTC(new Date(Date.UTC(y, m - 1, d + toMonday + 6))),
  };
};

export interface WeekOption extends DateRange {
  label: string;
}

/** Short "Aug 31 – Sep 6" label for a week. */
const weekLabel = ({ from, to }: DateRange): string => {
  const [, fM, fD] = from.split("-").map(Number);
  const [, tM, tD] = to.split("-").map(Number);
  return `${MONTH_NAMES[fM - 1]} ${fD} – ${MONTH_NAMES[tM - 1]} ${tD}`;
};

/** Every Monday-to-Sunday week overlapping the given calendar month, in order. */
export const weeksInMonth = (year: number, monthIndex: number): WeekOption[] => {
  const month = monthRange(year, monthIndex);
  const weeks: WeekOption[] = [];
  let week = weekRange(month.from);
  while (week.from <= month.to) {
    weeks.push({ ...week, label: weekLabel(week) });
    const [y, m, d] = week.from.split("-").map(Number);
    week = weekRange(fmtUTC(new Date(Date.UTC(y, m - 1, d + 7))));
  }
  return weeks;
};

/** Get current month boundaries using the user's saved timezone. */
export const getCurrentMonth = (tzOffset: number): DateRange => {
  const now = getLocalToday(tzOffset);
  return monthRange(now.getUTCFullYear(), now.getUTCMonth());
};

/** True when from/to cover exactly one whole calendar month. */
const coversWholeMonth = (from: string, to: string): boolean => {
  const month = monthRange(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1);
  return from === month.from && to === month.to;
};

/** True when from/to cover exactly one whole calendar year. */
const coversWholeYear = (from: string, to: string): boolean => {
  const year = yearRange(Number(from.slice(0, 4)));
  return from === year.from && to === year.to;
};

/** Format period label from from/to strings. */
export const formatPeriodLabel = (periodType: PeriodType, from: string, to: string): string => {
  if (periodType === "all") return ALL_TIME_LABEL;

  const [fY, fM, fD] = from.split("-").map(Number);
  const [tY, tM, tD] = to.split("-").map(Number);

  if (periodType === "monthly") {
    return `${MONTH_FULL[fM - 1]} ${fY}`;
  }
  if (periodType === "yearly") {
    return `${fY}`;
  }
  if (periodType === "weekly") {
    if (fY === tY) {
      return `${MONTH_NAMES[fM - 1]} ${fD} – ${MONTH_NAMES[tM - 1]} ${tD}, ${tY}`;
    }
    return `${MONTH_NAMES[fM - 1]} ${fD}, ${fY} – ${MONTH_NAMES[tM - 1]} ${tD}, ${tY}`;
  }
  // Custom — only show a month or year label if the range covers the whole of one
  if (coversWholeMonth(from, to)) {
    return `${MONTH_FULL[fM - 1]} ${fY}`;
  }
  if (coversWholeYear(from, to)) {
    return `${fY}`;
  }
  if (fY === tY) {
    return `${MONTH_NAMES[fM - 1]} ${fD} – ${MONTH_NAMES[tM - 1]} ${tD}, ${tY}`;
  }
  return `${MONTH_NAMES[fM - 1]} ${fD}, ${fY} – ${MONTH_NAMES[tM - 1]} ${tD}, ${tY}`;
};

/**
 * Navigate to the previous/next period.
 *
 * Returns the resulting period type as well as its days, because leaving All time
 * genuinely changes it: without that, a second arrow press would land on the
 * current month again instead of advancing past it.
 */
export const navigatePeriod = (
  periodType: PeriodType,
  from: string,
  to: string,
  direction: "prev" | "next",
  tzOffset: number,
): PeriodSelection => {
  // All time has no neighbours. An arrow press moves to the account's current
  // month, which is what the transactions toolbar has always done.
  if (periodType === "all") {
    return { periodType: "monthly", ...getCurrentMonth(tzOffset) };
  }

  const [fY, fM, fD] = from.split("-").map(Number);
  const sign = direction === "next" ? 1 : -1;

  if (periodType === "monthly") {
    return { periodType, ...monthRange(fY, fM - 1 + sign) };
  }

  if (periodType === "yearly") {
    return { periodType, ...yearRange(fY + sign) };
  }

  const [tY, tM, tD] = to.split("-").map(Number);

  // A custom range that happens to be a whole calendar month or year navigates by
  // the calendar rather than by its day span, so December steps to January.
  if (periodType === "custom" && coversWholeMonth(from, to)) {
    return { periodType, ...monthRange(fY, fM - 1 + sign) };
  }
  if (periodType === "custom" && coversWholeYear(from, to)) {
    return { periodType, ...yearRange(fY + sign) };
  }

  // Weekly or other custom: shift by the exact day span
  const span = Math.round((Date.UTC(tY, tM - 1, tD) - Date.UTC(fY, fM - 1, fD)) / DAY_MS) + 1;
  return {
    periodType,
    from: fmtUTC(new Date(Date.UTC(fY, fM - 1, fD + sign * span))),
    to: fmtUTC(new Date(Date.UTC(tY, tM - 1, tD + sign * span))),
  };
};

/** Map period type to internal chart granularity. */
export const chartGranularity = (periodType: PeriodType, from: string, to: string): AnalyticsGranularity => {
  // Analytics never selects All time — its API requires a bounded window — but the
  // type is shared with the ledger, so give it a defined answer rather than a throw.
  if (periodType === "all") return "monthly";
  if (periodType === "yearly") return "monthly";
  if (periodType === "monthly") return "weekly";
  if (periodType === "weekly") return "weekly";
  // Custom: auto based on span
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (days < 90) return "weekly";
  if (days < 730) return "monthly";
  return "yearly";
};

export interface DatePreset {
  id: string;
  label: string;
  getRange: (tzOffset: number) => DateRange;
}

/** Quick date presets for the time range picker (computed in the user's timezone). */
export const DATE_PRESETS: DatePreset[] = [
  {
    id: "last-30",
    label: "Last 30 days",
    getRange: (tzOffset) => {
      const today = getLocalToday(tzOffset);
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29));
      return { from: fmtUTC(start), to: fmtUTC(today) };
    },
  },
  {
    id: "last-90",
    label: "Last 90 days",
    getRange: (tzOffset) => {
      const today = getLocalToday(tzOffset);
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 89));
      return { from: fmtUTC(start), to: fmtUTC(today) };
    },
  },
  {
    id: "ytd",
    label: "Year to date",
    getRange: (tzOffset) => {
      const today = getLocalToday(tzOffset);
      return { from: `${today.getUTCFullYear()}-01-01`, to: fmtUTC(today) };
    },
  },
];
