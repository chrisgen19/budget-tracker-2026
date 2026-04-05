import { useMemo } from "react";
import { useLabelsQuery } from "@/hooks/use-labels";
import { useUser } from "@/components/user-provider";
import { getScheduledLabelId, type ScheduleRule } from "@/lib/schedule-matching";

/**
 * Computes the auto-matching scheduled label for a given transaction date.
 * Returns the labelId that should be auto-applied, or null if none match.
 */
export function useScheduledLabel(transactionDate: string | undefined) {
  const { data: labels = [] } = useLabelsQuery();
  const { user } = useUser();

  const scheduleRules = useMemo<ScheduleRule[]>(() => {
    const rules: ScheduleRule[] = [];
    for (const label of labels) {
      for (const schedule of label.schedules) {
        rules.push({
          labelId: label.id,
          labelCreatedAt: label.createdAt,
          days: schedule.days,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        });
      }
    }
    return rules;
  }, [labels]);

  const scheduledLabelId = useMemo(() => {
    if (!transactionDate || scheduleRules.length === 0) return null;
    const dateUTC = new Date(transactionDate);
    if (isNaN(dateUTC.getTime())) return null;
    return getScheduledLabelId(dateUTC, user.timezoneOffset, scheduleRules);
  }, [transactionDate, scheduleRules, user.timezoneOffset]);

  return { scheduledLabelId };
}
