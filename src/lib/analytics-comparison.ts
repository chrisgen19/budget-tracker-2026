import {
  MIN_COVERAGE_PCT,
  describeCoverage,
  describePeriodProgress,
  daysBetweenCalendarDays,
  daysInCalendarMonth,
  shiftCalendarDay,
  type PeriodProgress,
} from "@/lib/period-progress";
import type { AnalyticsPeriodContext } from "@/types";

export interface CalendarRange {
  from: string;
  to: string;
}

export interface ResolvedAnalyticsPeriods {
  requested: CalendarRange;
  current: CalendarRange | null;
  previous: CalendarRange;
  progress: PeriodProgress;
}

const pad = (value: number): string => String(value).padStart(2, "0");

const wholeMonth = ({ from, to }: CalendarRange): boolean =>
  from.endsWith("-01") && to === `${from.slice(0, 7)}-${pad(daysInCalendarMonth(from.slice(0, 7)))}`;

const wholeYear = ({ from, to }: CalendarRange): boolean =>
  from.endsWith("-01-01") && to === `${from.slice(0, 4)}-12-31`;

const previousMonth = (from: string): CalendarRange => {
  const [year, month] = from.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  const key = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  return { from: `${key}-01`, to: `${key}-${pad(daysInCalendarMonth(key))}` };
};

const previousYear = (from: string): CalendarRange => {
  const year = Number(from.slice(0, 4)) - 1;
  return { from: `${year}-01-01`, to: `${year}-12-31` };
};

const previousRange = (range: CalendarRange): CalendarRange => {
  if (wholeMonth(range)) return previousMonth(range.from);
  if (wholeYear(range)) return previousYear(range.from);
  const span = daysBetweenCalendarDays(range.from, range.to) + 1;
  return {
    from: shiftCalendarDay(range.from, -span),
    to: shiftCalendarDay(range.to, -span),
  };
};

const clipPrevious = (
  requested: CalendarRange,
  previous: CalendarRange,
  progress: PeriodProgress,
): CalendarRange => {
  if (!progress.isPartial || progress.daysElapsed === 0) return previous;
  if (wholeMonth(requested)) {
    const throughDay = Number(progress.effectiveTo?.slice(8, 10));
    const lastDay = Math.min(throughDay, daysInCalendarMonth(previous.from.slice(0, 7)));
    return { ...previous, to: `${previous.from.slice(0, 7)}-${pad(lastDay)}` };
  }
  if (wholeYear(requested) && progress.effectiveTo) {
    const monthDay = progress.effectiveTo.slice(4);
    const candidate = `${previous.from.slice(0, 4)}${monthDay}`;
    const month = candidate.slice(0, 7);
    const day = Math.min(Number(candidate.slice(8, 10)), daysInCalendarMonth(month));
    return { ...previous, to: `${month}-${pad(day)}` };
  }
  return { ...previous, to: shiftCalendarDay(previous.from, progress.daysElapsed - 1) };
};

export const resolveAnalyticsPeriods = (
  requested: CalendarRange,
  today: string,
): ResolvedAnalyticsPeriods => {
  const progress = describePeriodProgress(requested.from, requested.to, today);
  const previous = clipPrevious(requested, previousRange(requested), progress);
  return {
    requested,
    current: progress.effectiveTo ? { from: requested.from, to: progress.effectiveTo } : null,
    previous,
    progress,
  };
};

export const buildAnalyticsPeriodContext = (
  periods: ResolvedAnalyticsPeriods,
  currentLoggedDays: Iterable<string>,
  previousLoggedDays: Iterable<string>,
  previousTransactionCount: number,
): AnalyticsPeriodContext => {
  const previousDays = daysBetweenCalendarDays(
    periods.previous.from,
    periods.previous.to,
  ) + 1;
  // Today is still under way, so it joins the coverage window only once something
  // has been logged on it. Counted regardless, someone who logs every evening reads
  // as 50% covered on the morning of the 2nd and loses every comparison.
  const loggedCurrentDays = new Set(currentLoggedDays);
  const { isPartial, effectiveTo, daysElapsed } = periods.progress;
  const todayStillOpen = isPartial && effectiveTo !== null && !loggedCurrentDays.has(effectiveTo);
  const currentDays = todayStillOpen ? daysElapsed - 1 : daysElapsed;
  const currentCoverage = describeCoverage(loggedCurrentDays, currentDays);
  const previousCoverage = describeCoverage(previousLoggedDays, previousDays);

  let comparisonStatus: AnalyticsPeriodContext["comparisonStatus"] = "available";
  if (!periods.current) comparisonStatus = "not-started";
  else if (previousTransactionCount === 0) comparisonStatus = "no-previous-data";
  else if (currentDays === 0) comparisonStatus = "too-early";
  else if (!currentCoverage.sufficient || !previousCoverage.sufficient) {
    comparisonStatus = "low-coverage";
  }

  return {
    requestedFrom: periods.requested.from,
    requestedTo: periods.requested.to,
    effectiveTo: periods.progress.effectiveTo,
    isPartial: periods.progress.isPartial,
    daysElapsed: periods.progress.daysElapsed,
    daysInPeriod: periods.progress.daysInPeriod,
    currentCoveragePct: currentCoverage.percent,
    previousCoveragePct: previousCoverage.percent,
    comparisonStatus,
    coverageThresholdPct: MIN_COVERAGE_PCT,
  };
};
