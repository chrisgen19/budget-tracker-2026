const MINUTE_MS = 60_000;

/**
 * Shift an instant onto the user's saved wall clock.
 *
 * The returned Date must be read with UTC accessors/formatters. It represents wall-clock
 * components, not a new real instant. `timezoneOffset` follows `Date#getTimezoneOffset`, so
 * UTC+8 is -480 and local wall time is `instant - offset`.
 */
export const toAccountWallClock = (
  instant: Date | string,
  timezoneOffset: number,
): Date => {
  const parsed = instant instanceof Date ? instant : new Date(instant);
  return new Date(parsed.getTime() - timezoneOffset * MINUTE_MS);
};
const pad = (value: number) => String(value).padStart(2, "0");

const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * True for a `YYYY-MM-DD` string naming a day that exists.
 *
 * A format-only check is not enough: "2026-02-31" matches the shape, and
 * `Date.UTC` then rolls it forward to March 3 rather than complaining — so a
 * filter built from it would quietly query a different range than the one asked
 * for. Round-tripping the parsed date back to its parts is what catches that.
 */
export const isCalendarDay = (value: string): boolean => {
  if (!DAY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

/** Format an instant as the user's saved local `YYYY-MM-DDTHH:mm` wall time. */
export const formatAccountDateInput = (
  instant: Date | string,
  timezoneOffset: number,
): string => {
  const local = toAccountWallClock(instant, timezoneOffset);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};

/** Format an instant as the user's saved local `YYYY-MM-DD` calendar day. */
export const accountDateKey = (
  instant: Date | string,
  timezoneOffset: number,
): string => formatAccountDateInput(instant, timezoneOffset).slice(0, 10);

/** Format an instant as the user's saved local `YYYY-MM` calendar month. */
export const accountMonthKey = (
  instant: Date | string,
  timezoneOffset: number,
): string => formatAccountDateInput(instant, timezoneOffset).slice(0, 7);

/** Combine a calendar date with an instant's clock time in the saved account timezone. */
export const combineAccountDateWithTime = (
  date: string,
  instant: Date | string,
  timezoneOffset: number,
): string =>
  `${date.slice(0, 10)}T${formatAccountDateInput(instant, timezoneOffset).slice(11)}`;

/** Return an account-local datetime input shifted by a whole number of calendar days. */
export const relativeAccountDateInput = (
  instant: Date | string,
  timezoneOffset: number,
  dayDelta: number,
): string => {
  const local = toAccountWallClock(instant, timezoneOffset);
  local.setUTCDate(local.getUTCDate() + dayDelta);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};
