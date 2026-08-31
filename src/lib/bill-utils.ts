import type { BillFrequency, BillOccurrenceStatus } from "@/types";
import { addUtcDays, clampToMonth, userToday, utcDayStart } from "@/lib/bill-dates";

export { addUtcDays, utcDayStart } from "@/lib/bill-dates";


/**
 * Advance a due date by the given frequency.
 *
 * @param currentDueDate  The current due date to advance from
 * @param frequency       The billing frequency
 * @param originalStartDay  The day-of-month from the original start date (used for MONTHLY to preserve intent)
 * @param customIntervalDays  Number of days for CUSTOM frequency
 * @returns The next due date
 */
export const computeNextDueDate = (
  currentDueDate: Date,
  frequency: BillFrequency,
  originalStartDay: number,
  customIntervalDays?: number | null,
): Date => {
  // Every branch works in UTC. These values are date-only and stored at midnight UTC, so local
  // getters read the *previous* day on any host behind Greenwich, and MONTHLY/ANNUALLY then set
  // the day-of-month one day late. Truncating afterwards cannot recover that.
  const year = currentDueDate.getUTCFullYear();
  const month = currentDueDate.getUTCMonth();
  const day = currentDueDate.getUTCDate();

  switch (frequency) {
    case "DAILY":
      return new Date(Date.UTC(year, month, day + 1));

    case "WEEKLY":
      return new Date(Date.UTC(year, month, day + 7));

    case "CUSTOM":
      return new Date(Date.UTC(year, month, day + (customIntervalDays ?? 1)));

    case "MONTHLY":
      // Built from components rather than `setMonth(+1)`, which overflows forward out of the
      // month it was aiming at: from 31 January it lands on 3 March, and the clamp that follows
      // then reads March's length and returns 31 March, skipping February altogether.
      return clampToMonth(year, month + 1, originalStartDay);

    case "ANNUALLY":
      // Same shape, and it is what turns 29 February into 28 February in a non-leap year.
      return clampToMonth(year + 1, month, originalStartDay);
  }

  return new Date(currentDueDate);
};

/**
 * Walk a bill's due date forward past any PAID or SKIPPED occurrences so the
 * displayed/next due date reflects the true next unpaid occurrence.
 *
 * Why: editing a bill (frequency/startDate) or partial write failures can leave
 * `nextDueDate` pointing at a date that already has a terminal log. Callers
 * should use this helper so the UI and the cron/email path stay in sync with
 * the actual payment history.
 *
 * Returns `null` when:
 *  - the next unpaid occurrence would fall past `endDate`, or
 *  - the walk hits `maxIterations` without finding an unpaid date (defensive
 *    stop — default 500, ~41 years of monthly bills, 1.3 years of daily)
 *
 * Callers should treat `null` as "no valid next occurrence" — the bill should
 * typically be deactivated rather than have a bogus date written.
 */
export const advanceToNextUnpaidOccurrence = (
  startingDueDate: Date,
  frequency: BillFrequency,
  originalStartDay: number,
  customIntervalDays: number | null | undefined,
  logs: ReadonlyArray<{ dueDate: Date; status: BillOccurrenceStatus }>,
  options: { endDate?: Date | null; maxIterations?: number } = {},
): Date | null => {
  const { endDate = null, maxIterations = 500 } = options;

  const terminalDueDates = new Set(
    logs
      .filter((log) => log.status === "PAID" || log.status === "SKIPPED")
      .map((log) => utcDayStart(log.dueDate).getTime()),
  );

  let candidate = utcDayStart(startingDueDate);

  for (let i = 0; i < maxIterations; i++) {
    if (endDate && candidate > endDate) return null;
    if (!terminalDueDates.has(candidate.getTime())) return candidate;
    candidate = utcDayStart(
      computeNextDueDate(candidate, frequency, originalStartDay, customIntervalDays)
    );
  }

  return null;
};

/** Format a BillFrequency enum value for display */
export const formatFrequency = (frequency: BillFrequency, customIntervalDays?: number | null): string => {
  switch (frequency) {
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return "Weekly";
    case "MONTHLY":
      return "Monthly";
    case "ANNUALLY":
      return "Annually";
    case "CUSTOM":
      return customIntervalDays ? `Every ${customIntervalDays} day${customIntervalDays === 1 ? "" : "s"}` : "Custom";
  }
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Format a date-only bill value for display.
 *
 * `timeZone: "UTC"` is the whole point. A due date is stored at midnight UTC and means "the
 * 5th"; formatting it in the browser's zone renders the 4th for every viewer west of Greenwich,
 * so a bill paid on time reads as a day late. Used for due dates and for occurrence log rows,
 * which are date-only in the same way.
 */
export const formatBillDate = (date: Date | string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));

/**
 * Describe how far off a bill's due date is, from the *user's* calendar day.
 *
 * Both sides are reduced to UTC-midnight day values before subtracting, so the difference is a
 * whole number of days by construction. The due date is already one (`utcDayStart`); "today"
 * comes from `userToday`, not from the browser, because between the user's midnight and UTC's
 * the two disagree and the bill would be announced overdue a day early -- the same reason
 * `PATCH /api/bills/[id]` resolves reactivation against the account offset.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention, so UTC+8 is -480.
 */
export const describeDueDate = (
  dueDate: Date | string,
  timezoneOffset: number,
  now: Date = new Date(),
): { text: string; isOverdue: boolean } => {
  const due = utcDayStart(new Date(dueDate));
  const today = userToday(timezoneOffset, now);
  const diffDays = Math.round((due.getTime() - today.getTime()) / MS_PER_DAY);

  if (diffDays < 0) {
    const days = Math.abs(diffDays);
    return { text: `${days} day${days === 1 ? "" : "s"} overdue`, isOverdue: true };
  }
  if (diffDays === 0) return { text: "Due today", isOverdue: false };
  if (diffDays === 1) return { text: "Due tomorrow", isOverdue: false };
  return { text: `Due ${formatBillDate(due)}`, isOverdue: false };
};
