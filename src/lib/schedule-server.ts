/**
 * Server-side schedule helpers — wraps Prisma queries + schedule matching.
 * Use in API routes. For client-side matching, use schedule-matching.ts directly.
 */

import { prisma } from "@/lib/prisma";
import { getScheduledLabelId, type ScheduleRule } from "@/lib/schedule-matching";

export interface ScheduleContext {
  scheduleRules: ScheduleRule[];
  timezoneOffset: number;
  /** Set of label IDs that have at least one schedule */
  scheduledLabelIds: Set<string>;
}

/**
 * Fetch all schedule rules and timezone for a user.
 * Returns null if the user has no labels with schedules (allows callers to short-circuit).
 */
export const getScheduleContext = async (userId: string): Promise<ScheduleContext | null> => {
  const labelsWithSchedules = await prisma.label.findMany({
    where: { userId, schedules: { some: {} } },
    include: { schedules: true },
    orderBy: { createdAt: "asc" },
  });

  if (labelsWithSchedules.length === 0) return null;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezoneOffset: true },
  });

  const scheduleRules: ScheduleRule[] = labelsWithSchedules.flatMap((label) =>
    label.schedules.map((s) => ({
      labelId: label.id,
      labelCreatedAt: label.createdAt,
      applicableTo: label.applicableTo,
      days: s.days,
      startTime: s.startTime,
      endTime: s.endTime,
    }))
  );

  return {
    scheduleRules,
    timezoneOffset: user.timezoneOffset,
    scheduledLabelIds: new Set(labelsWithSchedules.map((l) => l.id)),
  };
};

/**
 * Compute the scheduled label for a given date using a pre-fetched context.
 */
export const matchScheduledLabel = (
  date: Date,
  ctx: ScheduleContext,
  transactionType?: string
): string | null => {
  return getScheduledLabelId(date, ctx.timezoneOffset, ctx.scheduleRules, transactionType);
};
