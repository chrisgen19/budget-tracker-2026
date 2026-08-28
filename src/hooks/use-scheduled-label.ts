import { useMemo } from "react";
import { useLabelsQuery } from "@/hooks/use-labels";
import { useUser } from "@/components/user-provider";
import { getScheduledLabelId, type ScheduleRule } from "@/lib/schedule-matching";

/**
 * Computes the auto-matching scheduled label for a transaction instant and type.
 * `transactionInstant` must carry `Z` or an explicit offset; a zone-less wall time would
 * otherwise be parsed in the browser timezone before the account offset is applied.
 * Returns the labelId that should be auto-applied, or null if none match.
 */
export function useScheduledLabel(transactionInstant: string | undefined, transactionType?: string) {
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
    return getScheduledLabelId(dateUTC, user.timezoneOffset, scheduleRules, transactionType);
  }, [transactionInstant, scheduleRules, user.timezoneOffset, transactionType]);

  return { scheduledLabelId };
}
