import { accountDateKey } from "@/lib/account-time";
import { formatCurrency, maskCurrency } from "@/lib/utils";
import type { BalanceMonth, BalanceTrendItem } from "@/types";

/**
 * The dashboard's Balance Trend: the running balance day by day for the selected month and the
 * month before it, so the card can overlay the two by day of month.
 *
 * Every day key is a calendar day in the user's saved timezone, built with UTC calendar
 * arithmetic, so neither the server's nor the browser's own zone can shift a row across midnight.
 */

export type BalanceTrendRow = {
  amount: number;
  type: "INCOME" | "EXPENSE";
  date: Date | string;
};

// `|| 0` turns -0 into 0, which float noise produces and Intl would print as "-₱0.00".
const cents = (value: number) => Math.round(value * 100) / 100 || 0;

/** A change with its sign spelled out ("+₱8,000.00", "-₱1,500.00"), or the app-wide mask. */
export const formatSignedAmount = (amount: number, currency: string, hide: boolean): string =>
  hide
    ? maskCurrency(amount, currency, true)
    : `${amount > 0 ? "+" : ""}${formatCurrency(amount, currency)}`;

const parseMonthKey = (month: string): [number, number] => {
  const [year, monthNumber] = month.split("-").map(Number);
  return [year, monthNumber];
};

/** The month before a YYYY-MM month, as YYYY-MM. */
export const previousMonthKey = (month: string): string => {
  const [year, monthNumber] = parseMonthKey(month);
  return new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 7);
};

/** A YYYY-MM month's short English name: "2026-09" → "Sep". */
export const monthShortName = (month: string): string => {
  const [year, monthNumber] = parseMonthKey(month);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  );
};

const monthDayKeys = (month: string): string[] => {
  const [year, monthNumber] = parseMonthKey(month);
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};

/**
 * Walk the selected month and the one before it, one closing balance per calendar day.
 *
 * `rows` must be every transaction from the 1st of the previous month through the end of the
 * selected month, and `closingBalance` the all-time running balance at the end of the selected
 * month. The opening balance is derived from the two rather than queried, so the last day always
 * lands on `closingBalance` exactly.
 */
export const buildBalanceMonths = ({
  month,
  closingBalance,
  rows,
  timezoneOffset,
}: {
  month: string;
  closingBalance: number;
  rows: BalanceTrendRow[];
  timezoneOffset: number;
}): { current: BalanceMonth; previous: BalanceMonth } => {
  const netByDay = new Map<string, number>();
  // Counted from the rows, not inferred from the balances: a purchase and its refund on the same
  // day leave every closing balance unchanged, and that month still had something logged.
  const rowsByMonth = new Map<string, number>();
  let windowNet = 0;
  for (const row of rows) {
    const delta = row.type === "INCOME" ? row.amount : -row.amount;
    windowNet += delta;
    const key = accountDateKey(row.date, timezoneOffset);
    netByDay.set(key, (netByDay.get(key) ?? 0) + delta);
    const monthKey = key.slice(0, 7);
    rowsByMonth.set(monthKey, (rowsByMonth.get(monthKey) ?? 0) + 1);
  }

  // Accumulate unrounded and round only what is returned, so cents never drift across 60 days.
  let running = closingBalance - windowNet;
  const walk = (key: string): BalanceMonth => {
    const openingBalance = cents(running);
    const days = monthDayKeys(key).map((date) => {
      running += netByDay.get(date) ?? 0;
      return { date, balance: cents(running) };
    });
    return { month: key, openingBalance, transactionCount: rowsByMonth.get(key) ?? 0, days };
  };

  const previous = walk(previousMonthKey(month));
  const current = walk(month);
  return { current, previous };
};

/**
 * The 30 days ending on the selected month's last day: what `balanceTrend` meant before
 * `balanceMonths` existed. A tab still running that build takes its "Last 30 Days" figure from the
 * first entry, so the field keeps its old meaning for one release instead of changing under it.
 * The two months always hold at least 56 days, so the slice is always a full 30.
 */
export const legacyBalanceTrend = ({
  current,
  previous,
}: {
  current: BalanceMonth;
  previous: BalanceMonth;
}): BalanceTrendItem[] => [...previous.days, ...current.days].slice(-30);

/** How many days of `month` have happened by `todayKey`: 0 for a month still ahead. */
const countElapsedDays = (month: BalanceMonth, todayKey: string): number =>
  month.days.filter((day) => day.date <= todayKey).length;

export type BalanceChartRow = { day: number; current?: number; previous?: number };

/**
 * One row per day of month for the chart. The selected month stops at today: the days after it
 * hold no forecast, only a copy of today's balance, so drawing them would imply one.
 *
 * With `compare` on, both months are shown as the change since their own opening balance, which
 * is what lines them up: two absolute balances sit a month's savings apart and only their slopes
 * could be compared.
 */
export const buildBalanceChartRows = ({
  current,
  previous,
  todayKey,
  compare,
}: {
  current: BalanceMonth;
  previous: BalanceMonth;
  todayKey: string;
  compare: boolean;
}): BalanceChartRow[] => {
  const elapsed = countElapsedDays(current, todayKey);
  const length = compare
    ? Math.max(current.days.length, previous.days.length)
    : current.days.length;

  return Array.from({ length }, (_, i) => {
    const row: BalanceChartRow = { day: i + 1 };
    if (i < elapsed) {
      const { balance } = current.days[i];
      row.current = compare ? cents(balance - current.openingBalance) : balance;
    }
    if (compare && i < previous.days.length) {
      row.previous = cents(previous.days[i].balance - previous.openingBalance);
    }
    return row;
  });
};

export type BalanceSummary = {
  /** Where the selected month sits against today. */
  status: "past" | "current" | "future";
  /** Days of the selected month shown on the chart. */
  elapsedDays: number;
  /** Closing balance on the last elapsed day, or the opening balance for a future month. */
  balance: number;
  /** Change since the month opened, up to the last elapsed day. */
  change: number;
  /**
   * The previous month's change by the same day of month, or over the whole month once the
   * selected one is over. Null when nothing was logged in the previous month, since "ahead of a
   * month you never logged" is not a comparison.
   */
  previousChange: number | null;
};

/** The figures the card's header states, all measured to the same day the chart stops at. */
export const summarizeBalance = (
  current: BalanceMonth,
  previous: BalanceMonth,
  todayKey: string,
): BalanceSummary => {
  const todayMonth = todayKey.slice(0, 7);
  const status =
    current.month < todayMonth ? "past" : current.month > todayMonth ? "future" : "current";
  const elapsedDays = countElapsedDays(current, todayKey);

  if (elapsedDays === 0) {
    return { status, elapsedDays, balance: current.openingBalance, change: 0, previousChange: null };
  }

  const balance = current.days[elapsedDays - 1].balance;
  const hasPreviousActivity = previous.transactionCount > 0;
  // Mar 31 is compared with Feb 28, and a finished month with the whole of the one before it.
  const compareDay =
    status === "past" ? previous.days.length : Math.min(elapsedDays, previous.days.length);

  return {
    status,
    elapsedDays,
    balance,
    change: cents(balance - current.openingBalance),
    previousChange: hasPreviousActivity
      ? cents(previous.days[compareDay - 1].balance - previous.openingBalance)
      : null,
  };
};

/** The smallest of 1, 2 or 5 times a power of ten that is at least `rough`. */
const niceStep = (rough: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
};

/**
 * Y-axis bounds with 10% headroom, and round-number ticks inside them. The span is floored at 5%
 * of the largest magnitude, so a ₱200 wobble on a ₱60,000 balance stays a wobble instead of being
 * stretched to the full height, which `["dataMin", "dataMax"]` did. Recharts only rounds ticks for
 * an `auto` domain, so an explicit one needs its ticks supplied or they land on 58.6K and 63.1K.
 */
export const balanceYAxis = (
  values: number[],
  includeZero: boolean,
): { domain: [number, number]; ticks: number[] } => {
  const all = includeZero ? [...values, 0] : values;
  if (all.length === 0) return { domain: [0, 1], ticks: [0, 1] };

  let min = Math.min(...all);
  let max = Math.max(...all);
  const floor = Math.max(Math.abs(min), Math.abs(max)) * 0.05 || 1;
  if (max - min < floor) {
    const mid = (min + max) / 2;
    min = mid - floor / 2;
    max = mid + floor / 2;
  }
  const pad = (max - min) * 0.1;
  const domain: [number, number] = [min - pad, max + pad];

  const step = niceStep((domain[1] - domain[0]) / 5);
  const ticks: number[] = [];
  for (let i = Math.ceil(domain[0] / step); i * step <= domain[1]; i++) {
    ticks.push(Number((i * step).toPrecision(12)));
  }
  return { domain, ticks };
};
