import { useMemo } from "react";
import { useLabelsQuery } from "@/hooks/use-labels";
import { useUser } from "@/components/user-provider";
import { getScheduledLabelId, type ScheduleRule } from "@/lib/schedule-matching";

/**
 * Computes the auto-matching scheduled label for a transaction instant and type.
 * `transactionInstant` must carry `Z` or an explicit offset; a zone-less wall time would
 * otherwise be parsed in the browser timezone before the account offset is applied.
 * Returns the labelId that should be auto-applied, or null if none match.
 *
 * `categoryId` is what the row is being filed under, so a label restricted to other categories is
 * not auto-applied. It mirrors the same argument on the server's `matchScheduledLabel`; the two
 * have to agree or the form shows an "Auto-applied" badge for a label the write then drops.
 */
export function useScheduledLabel(
  transactionInstant: string | undefined,
  transactionType?: string,
  categoryId?: string | null
) {
  const { data: labels = [] } = useLabelsQuery();
  const { user } = useUser();

  const scheduleRules = useMemo<ScheduleRule[]>(() => {
    const rules: ScheduleRule[] = [];
    for (const label of labels) {
      for (const schedule of label.schedules) {
        rules.push({
          labelId: label.id,
          labelCreatedAt: label.createdAt,
          applicableTo: label.applicableTo,
          categoryIds: label.categories.map((c) => c.categoryId),
          days: schedule.days,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        });
      }
    }
    return rules;
  }, [labels]);

  const scheduledLabelId = useMemo(() => {
    if (!transactionInstant || scheduleRules.length === 0) return null;
    const dateUTC = new Date(transactionInstant);
    if (isNaN(dateUTC.getTime())) return null;
    return getScheduledLabelId(
      dateUTC,
      user.timezoneOffset,
      scheduleRules,
      transactionType,
      categoryId
    );
  }, [transactionInstant, scheduleRules, user.timezoneOffset, transactionType, categoryId]);

  return { scheduledLabelId };
}
