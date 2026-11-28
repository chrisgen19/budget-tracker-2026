/**
 * Pure date logic for `heal-bill-next-due-dates.ts`, kept import-safe (no Prisma client at
 * module scope) so it can be unit-tested without a database.
 *
 * Every value here is a date-only bill date stored at UTC midnight, so every truncation and
 * every day-of-month read goes through UTC. The script used `setHours(0, 0, 0, 0)` and
 * `getDate()`, which work in the *process* zone: on a host in Asia/Manila they moved each due
 * date to 16:00 UTC the day before, so all five live bills reported a day of drift that did not
 * exist, and three paid PLDT months were listed as unreachable on the 19th when the bill falls on
 * the 20th. Behind Greenwich `getDate()` also reads the start day one day early, which is the
 * anchor `computeNextDueDate` uses for every later month, so `--apply` could have written it.
 */
import type { BillFrequency, BillOccurrenceStatus } from "@prisma/client";
import {
  advanceToNextUnpaidOccurrence,
  computeNextDueDate,
  utcDayStart,
} from "../src/lib/bill-utils";

export type HealBill = {
  frequency: BillFrequency;
  customIntervalDays: number | null;
  startDate: Date;
  nextDueDate: Date;
  endDate?: Date | null;
};

export type HealLog = { dueDate: Date; status: BillOccurrenceStatus };

/** Day-precision key for a bill date: the UTC calendar day, never the host's. */
const dayKey = (date: Date): string => utcDayStart(date).toISOString().slice(0, 10);

/**
 * Where a bill's cursor is and where it should be.
 *
 * `resolved` is `null` when the walk runs past `endDate`, meaning the bill should be switched off.
 * `drifted` is false when the stored cursor already names the first unpaid occurrence.
 */
export const resolveCursor = (bill: HealBill, logs: ReadonlyArray<HealLog>) => {
  const current = utcDayStart(bill.nextDueDate);
  const resolved = advanceToNextUnpaidOccurrence(
    bill.nextDueDate,
    bill.frequency,
    bill.startDate.getUTCDate(),
    bill.customIntervalDays,
    logs,
    { endDate: bill.endDate ?? null },
  );
  return {
    current,
    resolved,
    drifted: resolved !== null && resolved.getTime() !== current.getTime(),
  };
};

/**
 * Occurrences before the cursor that carry no PAID or SKIPPED log, walked from `startDate`.
 *
 * `truncated` is true when the walk hit `maxIterations` or stopped advancing (a CUSTOM bill with a
 * stored interval of 0), so an empty `missing` list is only a clean result when it is false.
 */
export const findUnreachableOccurrences = (
  bill: HealBill,
  logs: ReadonlyArray<Pick<HealLog, "dueDate">>,
  maxIterations: number,
) => {
  const terminal = new Set(logs.map((l) => utcDayStart(l.dueDate).getTime()));
  const next = utcDayStart(bill.nextDueDate);
  const startDay = bill.startDate.getUTCDate();

  let cursor = utcDayStart(bill.startDate);
  const missing: string[] = [];
  let truncated = false;

  for (let i = 0; cursor.getTime() < next.getTime(); i++) {
    if (i >= maxIterations) {
      truncated = true;
      break;
    }
    if (!terminal.has(cursor.getTime())) missing.push(dayKey(cursor));

    const advanced = utcDayStart(
      computeNextDueDate(cursor, bill.frequency, startDay, bill.customIntervalDays),
    );
    if (advanced.getTime() <= cursor.getTime()) {
      truncated = true;
      break;
    }
    cursor = advanced;
  }

  return { next, missing, truncated, scannedTo: cursor };
};
