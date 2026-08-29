/** The window a query ran over, as `search_transactions` and friends report it. */
export interface ReportedPeriod {
  month: string | null;
  from: string | null;
  to: string | null;
}

/**
 * Name the window a reply covers, from what the server says it actually queried.
 *
 * Built from the server's echo rather than from the filters the bot sent, because those are not
 * the same thing: an unresolvable day is dropped on the way in, so a reply built from the request
 * would claim a narrower window than was searched. The header exists precisely to stop a wider
 * answer passing for a narrower one, and it can only do that if it describes the real window.
 *
 * Returns an empty string for no period at all, so callers can append it unconditionally.
 */
export const describeWindow = (period: ReportedPeriod | null | undefined): string => {
  if (!period) return "";
  if (period.month) return ` in ${period.month}`;
  if (period.from && period.to) {
    return period.from === period.to
      ? ` on ${period.from}`
      : ` from ${period.from} to ${period.to}`;
  }
  if (period.from) return ` since ${period.from}`;
  if (period.to) return ` up to ${period.to}`;
  return "";
};
