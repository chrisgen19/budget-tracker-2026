import { computeNextDueDate, utcDayStart } from "@/lib/bill-utils";
import { clampToMonth } from "@/lib/bill-dates";
import { minimumDue } from "@/lib/debt-payoff";
import { buildEstimateSamples, describeEstimateBasis, estimateBillAmount } from "@/lib/bill-estimate";

export type ForecastEventKind = "future-transaction" | "scheduled-income" | "bill" | "flexible-pace" | "savings-contribution" | "card-payment";
export type ForecastEvent = { date: string; amount: number; kind: ForecastEventKind; description: string; estimated: boolean; assumption: string; sourceId?: string };
export type ForecastDay = { date: string; projectedBalance: number; inflows: number; outflows: number; events: ForecastEvent[] };

export type ForecastSchedule = {
  id: string; amount: number; description: string; type: "INCOME" | "EXPENSE"; frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "ANNUALLY" | "CUSTOM";
  customIntervalDays: number | null; startDate: Date; endDate: Date | null; nextDueDate: Date; isVariable: boolean;
  payments: Array<{ id: string; date: Date; amount: number }>;
  occurrences: Array<{ dueDate: Date; transactionId: string | null }>;
};

export type ForecastCard = {
  id: string;
  name: string;
  /** What the card owes today. Nothing at or below zero is projected. */
  balance: number;
  /** Day of the month payment is due. Null means the date is unknown, and the card is skipped. */
  dueDay: number | null;
  /** A linked reminder bill already emits its own event, so a card with one is skipped. */
  billId: string | null;
  plannedPayment: number | null;
  observedMonthly: number | null;
  minimumPct: number | null;
  minimumFloor: number | null;
};

export type ForecastBudgetAllocation = {
  type: string;
  kind: string;
  remaining: number;
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

/**
 * What the credit cards will take out of the bank inside the horizon.
 *
 * Card payments are the largest known outflow most accounts have, and the forecast counted none of
 * them: a purchase lowers the tracked balance on the day it is made, while the money only leaves
 * the bank when the card is paid.
 *
 * Three rules decide whether a card appears at all, and each one is a refusal rather than a guess:
 *
 * - **A card with a linked reminder bill is skipped.** That bill already emits its own `bill` event
 *   from the same schedule, and counting both would take the payment out of the bank twice. The
 *   same guard the forecast applies to a recurring charge that matches a bill by name.
 * - **A card with no `dueDay` is skipped**, and the caller says so in its assumptions. The output
 *   of this forecast is the lowest projected balance *and the date it happens*, so placing a real
 *   outflow on a guessed day answers the question wrongly rather than approximately.
 * - **A card with nothing owed is skipped.** There is no payment to make.
 *
 * The amount is the most specific figure the card has: what the user plans to pay, else what they
 * have actually been paying, else the bank's minimum. `assumption` names which of the three it
 * used, because they mean quite different things.
 *
 * The projected balance is walked **down** across the horizon and each payment is capped at what is
 * left, so a 90-day forecast cannot take three 8,000 payments out of a 5,000 debt. It deliberately
 * does not accrue interest or new purchases over the horizon: both are unknowable here, and a card
 * paid off early in the window is the honest reading of what is known today.
 */
export const cardPaymentEvents = (
  cards: readonly ForecastCard[],
  from: string,
  to: string
): ForecastEvent[] => {
  const events: ForecastEvent[] = [];

  for (const card of cards) {
    if (card.billId !== null || card.dueDay === null || card.balance <= 0) continue;

    const planned = card.plannedPayment;
    const monthly =
      planned ?? card.observedMonthly ?? minimumDue(card.balance, card.minimumPct, card.minimumFloor);
    if (monthly === null || monthly <= 0) continue;

    const basis =
      planned !== null
        ? "the payment you planned for this card"
        : card.observedMonthly !== null
          ? "what you have been paying this card each month"
          : "this card's minimum payment";

    let remaining = card.balance;
    for (const date of monthlyDueDates(card.dueDay, from, to)) {
      if (remaining <= 0) break;
      const amount = money(Math.min(monthly, remaining));
      remaining = money(remaining - amount);
      events.push({
        date,
        amount,
        kind: "card-payment",
        description: `${card.name} payment`,
        estimated: true,
        assumption: `Based on ${basis}. Interest and new purchases on the card are not projected.`,
        sourceId: card.id,
      });
    }
  }

  return events;
};

/** Every occurrence of `dueDay` between the two days, clamped into a month that is shorter. */
const monthlyDueDates = (dueDay: number, from: string, to: string): string[] => {
  const dates: string[] = [];
  const fromDay = day(from);
  const toDay = day(to);
  const cursor = new Date(Date.UTC(fromDay.getUTCFullYear(), fromDay.getUTCMonth(), 1));

  while (cursor <= toDay) {
    const due = clampToMonth(cursor.getUTCFullYear(), cursor.getUTCMonth(), dueDay);
    if (due >= fromDay && due <= toDay) dates.push(key(due));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return dates;
};

/** Spread only budget money still unspent after actuals and rollover across the usable month. */
export const remainingBudgetPaceEvents = (
  month: string,
  allocations: ForecastBudgetAllocation[],
  today: string,
  to: string,
): ForecastEvent[] => {
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const firstDay = month === today.slice(0, 7) ? Number(today.slice(8)) : 1;
  const allocationDays = monthEnd - firstDay + 1;
  if (allocationDays <= 0) return [];

  return allocations
    .filter((row) => row.type === "EXPENSE" && (row.kind === "FLEXIBLE" || row.kind === "SAVINGS"))
    .flatMap((allocation) => {
      const remaining = Math.max(0, allocation.remaining);
      if (remaining === 0) return [];
      const amount = remaining / allocationDays;
      return Array.from({ length: monthEnd - firstDay + 1 }, (_, index) => firstDay + index)
        .map((number) => `${month}-${String(number).padStart(2, "0")}`)
        .filter((date) => date <= to)
        .map((date) => ({
          date,
          amount,
          kind: allocation.kind === "SAVINGS" ? "savings-contribution" : "flexible-pace" as const,
          description: allocation.kind === "SAVINGS" ? "Planned savings contribution" : "Flexible budget pace",
          estimated: true,
          assumption: `${allocation.kind === "SAVINGS" ? "Savings" : "Flexible"} budget remaining after logged spending is spread evenly across ${allocationDays} days.`,
        }));
    });
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
