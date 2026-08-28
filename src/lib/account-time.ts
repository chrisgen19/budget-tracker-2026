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
