import type { AnalyticsGranularity } from "@/types";
import { MONTH_NAMES, MONTH_FULL } from "@/lib/analytics-buckets";

export type PeriodType = AnalyticsGranularity | "custom";

/** Format a local date object's UTC parts as YYYY-MM-DD. */
const fmtUTC = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Get "today" shifted into the user's saved timezone (read via UTC accessors). */
export const getLocalToday = (tzOffset: number): Date =>
  new Date(Date.now() - tzOffset * 60 * 1000);

/** Get current month boundaries using the user's saved timezone. */
export const getCurrentMonth = (tzOffset: number): { from: string; to: string } => {
  const now = getLocalToday(tzOffset);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    from: `${y}-${String(m + 1).padStart(2, "0")}-01`,
    to: `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
};

/** Format period label from from/to strings. */
export const formatPeriodLabel = (periodType: PeriodType, from: string, to: string): string => {
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
  // Custom — only show full month label if range covers the entire month
  const lastDayOfMonth = new Date(fY, fM, 0).getDate();
  if (fY === tY && fM === tM && fD === 1 && tD === lastDayOfMonth) {
    return `${MONTH_FULL[fM - 1]} ${fY}`;
  }
  // Custom full year
  if (fY === tY && fM === 1 && fD === 1 && tM === 12 && tD === 31) {
    return `${fY}`;
  }
  if (fY === tY) {
    return `${MONTH_NAMES[fM - 1]} ${fD} – ${MONTH_NAMES[tM - 1]} ${tD}, ${tY}`;
  }
  return `${MONTH_NAMES[fM - 1]} ${fD}, ${fY} – ${MONTH_NAMES[tM - 1]} ${tD}, ${tY}`;
};

/** Navigate to previous/next period. */
export const navigatePeriod = (
  periodType: PeriodType,
  from: string,
  to: string,
  direction: "prev" | "next",
): { from: string; to: string } => {
  const [fY, fM, fD] = from.split("-").map(Number);
  const sign = direction === "next" ? 1 : -1;

  if (periodType === "monthly") {
    const d = new Date(fY, fM - 1 + sign, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return {
      from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      to: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  if (periodType === "yearly") {
    const y = fY + sign;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  const [tY, tM, tD] = to.split("-").map(Number);

  // Custom range that matches a full calendar month — navigate by month
  const lastDayOfFromMonth = new Date(fY, fM, 0).getDate();
  if (periodType === "custom" && fD === 1 && fY === tY && fM === tM && tD === lastDayOfFromMonth) {
    const d = new Date(fY, fM - 1 + sign, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return {
      from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      to: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  // Custom range that matches a full calendar year — navigate by year
  if (periodType === "custom" && fM === 1 && fD === 1 && tM === 12 && tD === 31 && fY === tY) {
    const y = fY + sign;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  // Weekly or other custom: shift by exact day span
  const fromDate = new Date(fY, fM - 1, fD);
  const toDate = new Date(tY, tM - 1, tD);
  const span = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  fromDate.setDate(fromDate.getDate() + sign * span);
  toDate.setDate(toDate.getDate() + sign * span);

  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmtDate(fromDate), to: fmtDate(toDate) };
};

/** Map period type to internal chart granularity. */
export const chartGranularity = (periodType: PeriodType, from: string, to: string): AnalyticsGranularity => {
  if (periodType === "yearly") return "monthly";
  if (periodType === "monthly") return "weekly";
  if (periodType === "weekly") return "weekly";
  // Custom: auto based on span (UTC midnight parse is intentional — only computing day count)
  const days = (new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000);
  if (days < 90) return "weekly";
  if (days < 730) return "monthly";
  return "yearly";
};

export interface DatePreset {
  id: string;
  label: string;
  getRange: (tzOffset: number) => { from: string; to: string };
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
