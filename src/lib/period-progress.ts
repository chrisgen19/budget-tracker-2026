const DAY_MS = 86_400_000;

/** Below this share of elapsed days, totals are a floor rather than a comparison baseline. */
export const MIN_COVERAGE_PCT = 60;

export const parseCalendarDay = (day: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
};

const formatDay = (date: Date): string => date.toISOString().slice(0, 10);

export const daysBetweenCalendarDays = (from: string, to: string): number =>
  Math.round((parseCalendarDay(to).getTime() - parseCalendarDay(from).getTime()) / DAY_MS);

export const daysInCalendarMonth = (month: string): number => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
};

export const shiftCalendarDay = (day: string, amount: number): string => {
  const date = parseCalendarDay(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDay(date);
};

/** Resolve an instant to YYYY-MM-DD in the app's getTimezoneOffset convention. */
export const localCalendarDay = (instant: Date, timezoneOffset: number): string =>
  formatDay(new Date(instant.getTime() - timezoneOffset * 60_000));

export interface PeriodProgress {
  isPartial: boolean;
  daysInPeriod: number;
  daysElapsed: number;
  /** Last calendar day that has happened, or null when the range is wholly future. */
  effectiveTo: string | null;
}

/**
 * Describe how much of a closed calendar-day range has happened.
 *
 * A range ending today is partial because more transactions can still land
 * today. This is intentionally shared by Analytics, Assessment Facts and MCP
 * budget queries so each surface uses the same meaning of "so far".
 */
export const describePeriodProgress = (
  from: string,
  to: string,
  today: string,
): PeriodProgress => {
  const daysInPeriod = daysBetweenCalendarDays(from, to) + 1;
  const effectiveTo = from > today ? null : to < today ? to : today;
  const daysElapsed = effectiveTo
    ? Math.max(0, Math.min(daysInPeriod, daysBetweenCalendarDays(from, effectiveTo) + 1))
    : 0;

  return {
    isPartial: to >= today,
    daysInPeriod,
    daysElapsed,
    effectiveTo,
  };
};

export interface CoverageDescription {
  percent: number;
  sufficient: boolean;
}

/**
 * Describe logging coverage without rounding a value up across the trust gate.
 *
 * The integer percentage is presentation data. Sufficiency is evaluated from
 * the exact ratio so 31 of 52 days (59.6%) cannot become trustworthy merely
 * because its display value rounds to 60%.
 */
export const describeCoverage = (
  loggedDays: Iterable<string>,
  daysInWindow: number,
  thresholdPct = MIN_COVERAGE_PCT,
): CoverageDescription => {
  if (daysInWindow <= 0) return { percent: 0, sufficient: false };
  const loggedDayCount = new Set(loggedDays).size;
  const rawPercent = (loggedDayCount / daysInWindow) * 100;
  return {
    percent: Math.floor(rawPercent),
    sufficient: rawPercent >= thresholdPct,
  };
};

export const coveragePercent = (loggedDays: Iterable<string>, daysInWindow: number): number =>
  describeCoverage(loggedDays, daysInWindow).percent;
