/**
 * Whole months between a `YYYY-MM` and now, in the user's own calendar.
 *
 * Used to size the bill-history window from the month being asked about. A fixed window returned
 * recent rows for an older question, which made the code think the bill had history, skip its
 * fallback, and then report that the older occurrence never existed. Getting this wrong by one
 * reintroduces exactly that.
 *
 * Never negative: a future month needs no history at all, and a negative window would be
 * nonsense rather than merely wrong.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention, so UTC+8 is -480.
 */
export const monthsSince = (month: string, timezoneOffset: number, now = new Date()): number => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return 0;

  const [, y, m] = match;
  const local = new Date(now.getTime() - timezoneOffset * 60_000);
  return Math.max(0, (local.getUTCFullYear() - Number(y)) * 12 + (local.getUTCMonth() + 1 - Number(m)));
};

/**
 * The month before a `YYYY-MM`.
 *
 * Done on the string rather than through `Date`, because constructing a Date from a month and
 * stepping back a month is where off-by-one timezone errors come from, and this needs none of
 * that: January's predecessor is last December regardless of where anyone is standing.
 */
export const previousMonthOf = (month: string): string => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return month;

  const [, y, m] = match;
  const monthNumber = Number(m);
  return monthNumber === 1
    ? `${Number(y) - 1}-12`
    : `${y}-${String(monthNumber - 1).padStart(2, "0")}`;
};
