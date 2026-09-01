/**
 * The user's wall clock, as an ISO timestamp with no zone suffix.
 *
 * `toISOString()` alone appends `Z`. Shifting the instant to the user's wall clock and then
 * calling it labels that wall time as UTC, which is a lie: 18:30 in Manila is not 18:30Z. It
 * matters because the prompt hands this string to Gemini as "now", and `resolveTransactionDate`
 * treats an explicit `Z` or offset as authoritative and skips conversion. A model that copied the
 * supplied timestamp for a current transaction would have stored it eight hours in the future for
 * a UTC+8 user, crossing a day and sometimes a month boundary.
 *
 * Dropping the suffix leaves an offset-less local time, which is the shape the prompt's own
 * example uses and the one the server resolves against `users.timezone_offset`.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention, so UTC+8 is -480.
 */
export const localTimestamp = (timezoneOffset: number, now = new Date()): string =>
  new Date(now.getTime() - timezoneOffset * 60_000).toISOString().slice(0, 19);

/**
 * Render a scan's date for the review, whether or not it carries a time.
 *
 * `scanReceipt` now returns `YYYY-MM-DDTHH:mm` whenever the receipt printed a time, and the raw
 * `T` reads as a glitch in a chat message. The review is the one moment the user can correct a
 * misread clock before it is written, so the time has to be shown rather than sliced off.
 *
 * A bare date is passed through untouched, because a receipt that printed no time has none to
 * show and inventing "00:00" here would claim a precision the scan never had.
 */
export const formatScanDate = (value: string): string =>
  value.length > 10 ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : value;
