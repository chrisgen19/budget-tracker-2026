import { computeNextDueDate, utcDayStart } from "@/lib/bill-utils";
import { buildEstimateSamples, describeEstimateBasis, estimateBillAmount } from "@/lib/bill-estimate";

export type ForecastEventKind = "future-transaction" | "scheduled-income" | "bill" | "flexible-pace" | "savings-contribution";
export type ForecastEvent = { date: string; amount: number; kind: ForecastEventKind; description: string; estimated: boolean; assumption: string; sourceId?: string };
export type ForecastDay = { date: string; projectedBalance: number; inflows: number; outflows: number; events: ForecastEvent[] };

export type ForecastSchedule = {
  id: string; amount: number; description: string; type: "INCOME" | "EXPENSE"; frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "ANNUALLY" | "CUSTOM";
  customIntervalDays: number | null; startDate: Date; endDate: Date | null; nextDueDate: Date; isVariable: boolean;
  payments: Array<{ id: string; date: Date; amount: number }>;
  occurrences: Array<{ dueDate: Date; transactionId: string | null }>;
};

const key = (date: Date) => date.toISOString().slice(0, 10);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Generates advertised upcoming occurrences; values are date-only UTC calendar days. */
export const scheduledForecastEvents = (schedules: ForecastSchedule[], from: string, to: string, timezoneOffset: number): ForecastEvent[] => {
  const events: ForecastEvent[] = [];
  const fromDay = day(from);
  const toDay = day(to);
  for (const schedule of schedules) {
    let due = utcDayStart(schedule.nextDueDate);
    const originalDay = schedule.startDate.getUTCDate();
    const settledDates = new Set(schedule.occurrences.map((occurrence) => key(occurrence.dueDate)));
    const eventForDue = (date: Date, overdue = false): ForecastEvent => {
      const estimate = schedule.isVariable && schedule.type === "EXPENSE"
        ? estimateBillAmount(buildEstimateSamples(schedule.payments, schedule.occurrences, timezoneOffset), date.getUTCMonth() + 1, date.getUTCFullYear(), schedule.amount)
        : null;
      return {
        date: overdue ? from : key(date), amount: estimate?.amount ?? schedule.amount,
        kind: schedule.type === "INCOME" ? "scheduled-income" : "bill",
        sourceId: schedule.id,
        description: `${overdue ? "Overdue: " : ""}${schedule.description || (schedule.type === "INCOME" ? "Scheduled income" : "Scheduled bill")}`,
        estimated: estimate !== null,
        assumption: overdue
          ? `Overdue since ${key(date)}; included on the first forecast day.`
          : estimate ? `Variable bill estimate: ${describeEstimateBasis(estimate)}.` : "Scheduled amount set on this recurring item.",
      };
    };

    const aggregateDailyOverdue = schedule.frequency === "DAILY" ||
      (schedule.frequency === "CUSTOM" && schedule.customIntervalDays === 1);
    let overdueCount = 0;
    let overdueAmount = 0;
    let overdueIsEstimated = false;

    // Every missed weekly, monthly, and annual bill is still owed. Daily (including every-day
    // custom) backlogs are aggregated so a long-stale schedule does not create hundreds of rows.
    while (due < fromDay && (!schedule.endDate || due <= schedule.endDate)) {
      if (schedule.type === "EXPENSE" && !settledDates.has(key(due))) {
        const overdueEvent = eventForDue(due, true);
        if (aggregateDailyOverdue) {
          overdueCount += 1;
          overdueAmount += overdueEvent.amount;
          overdueIsEstimated ||= overdueEvent.estimated;
        } else {
          events.push(overdueEvent);
        }
      }
      due = utcDayStart(computeNextDueDate(due, schedule.frequency, originalDay, schedule.customIntervalDays));
    }

    if (overdueCount > 0) {
      events.push({
        date: from,
        amount: money(overdueAmount),
        kind: "bill",
        sourceId: schedule.id,
        description: `Overdue: ${schedule.description || "Scheduled bill"} (${overdueCount} occurrences)`,
        estimated: overdueIsEstimated,
        assumption: `${overdueCount} overdue daily occurrence${overdueCount === 1 ? "" : "s"} included on the first forecast day.`,
      });
    }

    while (due <= toDay && (!schedule.endDate || due <= schedule.endDate)) {
      if (!settledDates.has(key(due))) {
        events.push(eventForDue(due));
      }
      due = utcDayStart(computeNextDueDate(due, schedule.frequency, originalDay, schedule.customIntervalDays));
    }
  }
  return events;
};

export const buildCashFlowForecast = ({ openingBalance, from, to, events }: { openingBalance: number; from: string; to: string; events: ForecastEvent[] }) => {
  const byDay = new Map<string, ForecastEvent[]>();
  events.forEach((event) => byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]));
  const days: ForecastDay[] = [];
  let balance = openingBalance;
  for (let cursor = day(from); cursor <= day(to); cursor = new Date(cursor.getTime() + 86_400_000)) {
    const date = key(cursor);
    const entries = byDay.get(date) ?? [];
    const inflows = entries.filter((entry) => entry.kind === "scheduled-income" || (entry.kind === "future-transaction" && entry.amount > 0)).reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
    const outflows = entries.filter((entry) => entry.kind !== "scheduled-income" && !(entry.kind === "future-transaction" && entry.amount > 0)).reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
    balance = money(balance + inflows - outflows);
    days.push({ date, projectedBalance: balance, inflows: money(inflows), outflows: money(outflows), events: entries });
  }
  const lowest = days.reduce((result, item) => item.projectedBalance < result.projectedBalance ? item : result, days[0]);
  const crunches = days.filter((item, index) => item.projectedBalance < 0 && (index === 0 || days[index - 1].projectedBalance >= 0)).map((item) => ({ date: item.date, balance: item.projectedBalance }));
  return { days, lowestBalance: lowest ? { date: lowest.date, balance: lowest.projectedBalance } : null, cashCrunches: crunches };
};
