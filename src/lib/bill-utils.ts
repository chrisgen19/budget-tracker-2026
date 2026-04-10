import type { BillFrequency, BillOccurrenceStatus } from "@/types";

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
  const next = new Date(currentDueDate);

  switch (frequency) {
    case "DAILY":
      next.setDate(next.getDate() + 1);
      break;

    case "WEEKLY":
      next.setDate(next.getDate() + 7);
      break;

    case "MONTHLY": {
      // Move to next month, then clamp day to last day of that month
      next.setMonth(next.getMonth() + 1);
      const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(originalStartDay, lastDayOfMonth));
      break;
    }

    case "ANNUALLY": {
      next.setFullYear(next.getFullYear() + 1);
      // Handle Feb 29 → Feb 28 in non-leap years
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(originalStartDay, lastDay));
      break;
    }

    case "CUSTOM":
      next.setDate(next.getDate() + (customIntervalDays ?? 1));
      break;
  }

  return next;
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
      .map((log) => {
        const d = new Date(log.dueDate);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      }),
  );

  let candidate = new Date(startingDueDate);
  candidate.setHours(0, 0, 0, 0);

  for (let i = 0; i < maxIterations; i++) {
    if (endDate && candidate > endDate) return null;
    if (!terminalDueDates.has(candidate.getTime())) return candidate;
    candidate = computeNextDueDate(candidate, frequency, originalStartDay, customIntervalDays);
    candidate.setHours(0, 0, 0, 0);
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
