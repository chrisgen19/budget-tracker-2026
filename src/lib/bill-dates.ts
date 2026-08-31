/**
 * Date-only arithmetic for bill due dates, in UTC.
 *
 * Deliberately its own module with **no imports**. These helpers are shared by the MCP query
 * layer, and `bill-utils.ts` — their natural home — imports `@/types`, which augments
 * `next-auth`. `mcp-server/` has no such dependency, so reaching them through there breaks its
 * separate `pnpm type-check` while the root one stays green: exactly the drift that type-check
 * exists to catch.
 */

/**
 * Truncate a bill date to its calendar day, in UTC.
 *
 * Bill due dates are date-only: stored at midnight UTC, meaning "the 5th" rather than an
 * instant. `setHours(0, 0, 0, 0)` truncates in the *process* zone, which is a no-op only while
 * the server happens to run in UTC. On a host in Asia/Manila it rewrites a due date of the 5th
 * as `2026-09-04T16:00:00Z`, and every reader taking the UTC day then reports the 4th — turning
 * an on-time payment into a day late. Nothing pins `TZ`, so "happens to run in UTC" was the
 * whole guarantee.
 */
export const utcDayStart = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Add (or subtract) whole days to a date-only bill value, in UTC.
 *
 * `setDate(getDate() + n)` reads and writes through the process zone. For a UTC-midnight value
 * on a host behind Greenwich, `getDate()` already reports the previous day, so the arithmetic
 * starts from the wrong day before it adds anything.
 */
export const addUtcDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

/** The given day-of-month in a UTC month, clamped to that month's last day. */
export const clampToMonth = (year: number, month: number, day: number): Date => {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
};

/**
 * The user's current calendar day, encoded as a UTC-midnight date-only value.
 *
 * "Today" for a bill is the user's today, not the server's and not UTC's. At 02:00 on 30 August
 * in Manila the UTC day is still the 29th, so a bill reset to `utcDayStart(new Date())` would be
 * written a day in the past and read as immediately overdue.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention, so UTC+8 is -480.
 */
export const userToday = (timezoneOffset: number, now: Date = new Date()): Date =>
  utcDayStart(new Date(now.getTime() - timezoneOffset * 60_000));

/**
 * The `YYYY-MM-DD` calendar day a date-only bill value stands for.
 *
 * The counterpart to `utcDayStart` for anything that renders. A bill date is stored at midnight
 * UTC and means "the 5th" for everyone, so it is read back with UTC accessors and never
 * converted: `getDate()` in a browser west of Greenwich reports the 4th, and `accountDateKey`
 * would shift the anchor just as wrongly in the other direction. "Today" is the opposite case --
 * a real instant -- and belongs to `userToday`.
 */
export const utcDayKey = (date: Date | string): string => {
  const value = date instanceof Date ? date : new Date(date);
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
};
