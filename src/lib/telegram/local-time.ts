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
 * The user's calendar day for an instant, as `YYYY-MM-DD`.
 *
 * `search_transactions` returns `date` as a full UTC instant, while `create_transactions` returns
 * a day already resolved against the user's zone. Slicing the first ten characters off the former
 * therefore printed the UTC day: a transaction entered at 01:00 on 1 September in Manila is
 * stored as 2026-08-31T17:00:00Z and was shown as 31 August.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention, so UTC+8 is -480.
 */
export const localDay = (instant: string, timezoneOffset: number): string => {
  const parsed = new Date(instant);
  // An unparseable value is passed through rather than rendered as "Invalid Date": whatever the
  // server sent is more informative to look at than NaN.
  if (Number.isNaN(parsed.getTime())) return instant.slice(0, 10);
  return localTimestamp(timezoneOffset, parsed).slice(0, 10);
};
