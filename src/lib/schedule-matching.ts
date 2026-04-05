/**
 * Pure schedule-matching utility — no Prisma or React dependencies.
 * Shared between client (transaction form) and server (batch API, retroactive apply).
 */

export interface ScheduleRule {
  labelId: string;
  labelCreatedAt: Date | string;
  days: number[];
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
}

/**
 * Convert a UTC date to user-local time components using their timezone offset.
 * @param dateUTC  The UTC date
 * @param timezoneOffset  Offset in minutes (e.g. -480 for UTC+8)
 */
const toLocalComponents = (dateUTC: Date, timezoneOffset: number) => {
  const localMs = dateUTC.getTime() - timezoneOffset * 60 * 1000;
  const local = new Date(localMs);
  const day = local.getUTCDay();
  const hours = String(local.getUTCHours()).padStart(2, "0");
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");
  return { day, time: `${hours}:${minutes}` };
};

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
  scheduleRules: ScheduleRule[]
): string | null => {
  if (scheduleRules.length === 0) return null;

  const { day, time } = toLocalComponents(transactionDateUTC, timezoneOffset);

  // Find all rules that match this day + time window
  const matching = scheduleRules.filter(
    (r) => r.days.includes(day) && r.startTime <= time && time < r.endTime
  );

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
