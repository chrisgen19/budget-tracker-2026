/**
 * Pure schedule-matching utility — no Prisma or React dependencies.
 * Shared between client (transaction form) and server (batch API, retroactive apply).
 */

export interface ScheduleRule {
  labelId: string;
  labelCreatedAt: Date | string;
  applicableTo: string; // "EXPENSE" | "INCOME" | "BOTH"
  days: number[];
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
}

/**
 * Convert a UTC date to user-local time components using their timezone offset.
 *
 * Exported because the daily Telegram prompt asks the same question label schedules do - what
 * day and time is it where this user lives - and a second copy of the arithmetic is how the two
 * would come to disagree.
 *
 * @param dateUTC  The UTC date
 * @param timezoneOffset  Offset in minutes (e.g. -480 for UTC+8)
 */
export const toLocalComponents = (dateUTC: Date, timezoneOffset: number) => {
  const localMs = dateUTC.getTime() - timezoneOffset * 60 * 1000;
  const local = new Date(localMs);
  const day = local.getUTCDay();
  const hours = String(local.getUTCHours()).padStart(2, "0");
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");
  return { day, time: `${hours}:${minutes}` };
};

/**
 * Whether one rule covers a moment already resolved to the user's day and time.
 *
 * The single definition of "inside a schedule": auto-apply uses it to tag a row, and the
 * assessment's label audit uses it to ask which tagged rows the clock could have tagged. Two
 * copies of the window test would let the audit judge a schedule by a rule it does not run.
 */
export const scheduleRuleMatches = (
  rule: Pick<ScheduleRule, "days" | "startTime" | "endTime" | "applicableTo">,
  day: number,
  time: string,
  transactionType?: string
): boolean =>
  rule.days.includes(day) &&
  rule.startTime <= time &&
  time < rule.endTime &&
  (!transactionType || rule.applicableTo === "BOTH" || rule.applicableTo === transactionType);

/**
 * Given a transaction date (UTC) and the user's timezone offset,
 * returns the ID of the single scheduled label that should auto-apply,
 * or null if none match.
 *
 * Priority: the label with the earliest `createdAt` wins when multiple match.
 */
export const getScheduledLabelId = (
  transactionDateUTC: Date,
  timezoneOffset: number,
  scheduleRules: ScheduleRule[],
  transactionType?: string
): string | null => {
  if (scheduleRules.length === 0) return null;

  const { day, time } = toLocalComponents(transactionDateUTC, timezoneOffset);

  // Find all rules that match this day + time window + transaction type
  const matching = scheduleRules.filter((r) => scheduleRuleMatches(r, day, time, transactionType));

  if (matching.length === 0) return null;

  // Group by labelId and pick the label with the earliest createdAt
  const labelMap = new Map<string, Date>();
  for (const rule of matching) {
    const created = new Date(rule.labelCreatedAt);
    const existing = labelMap.get(rule.labelId);
    if (!existing || created < existing) {
      labelMap.set(rule.labelId, created);
    }
  }

  let earliest: { labelId: string; createdAt: Date } | null = null;
  for (const [labelId, createdAt] of labelMap) {
    if (!earliest || createdAt < earliest.createdAt) {
      earliest = { labelId, createdAt };
    }
  }

  return earliest?.labelId ?? null;
};
