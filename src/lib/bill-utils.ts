import type { BillFrequency } from "@/types";

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
