/**
 * `YYYY-MM` and `YYYY-MM-DD` keys as plain calendar values.
 *
 * A key names a month or day the user already resolved in their own timezone (`accountMonthKey`,
 * `accountDateKey`), so arithmetic and display here run in UTC on purpose: formatting the key in
 * the browser's zone would move a day west of Greenwich.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** The month `delta` months from `month`, across year boundaries. */
export const shiftMonthKey = (month: string, delta: number): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
};

/** "August 2026". */
export const formatMonthKey = (month: string): string =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** "Aug 25". */
export const formatDayKey = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
