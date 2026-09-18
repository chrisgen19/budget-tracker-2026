/**
 * Savings goals and sinking funds: what has been put aside on purpose, and whether it is enough.
 *
 * The whole point of the model is the word "on purpose". A positive net cash flow is money that
 * happened not to be spent; a goal is money assigned to something. Every figure here therefore
 * derives from explicit contribution rows and never from a residual, so a quiet month cannot read
 * as a month where the deposit got closer.
 *
 * Split the way `assessment-facts.ts` is: `summariseGoal` is pure arithmetic over injected rows
 * and is unit-tested without a database, while `getSavingsGoals` does nothing but fetch and
 * resolve dates into the user's own calendar.
 */
import type { PrismaClient } from "@prisma/client";
import { formatLocalDate, type SavingsGoalInput } from "@/lib/validations";
import {
  daysBetweenCalendarDays as daysBetween,
  parseCalendarDay as parseDay,
} from "@/lib/period-progress";
import type {
  SavingsGoalContributionRow,
  SavingsGoalPace,
  SavingsGoalSummary,
} from "@/types";

/** A goal as the arithmetic sees it: dates already resolved to the user's calendar days. */
export interface GoalFacts {
  id: string;
  name: string;
  kind: "GOAL" | "SINKING_FUND";
  status: "ACTIVE" | "ACHIEVED" | "ARCHIVED";
  targetAmount: number;
  /** "YYYY-MM-DD", or null for a goal with no deadline. */
  targetDate: string | null;
  notes: string | null;
  createdOn: string;
  contributions: SavingsGoalContributionRow[];
}

/**
 * How far behind its own required rate a goal may drift before it is off pace.
 *
 * Ten per cent, not zero. A goal funded by a monthly transfer is behind for twenty-nine days out
 * of every thirty by any exact reading, and an alert that fires on that is an alert nobody reads.
 */
const PACE_TOLERANCE = 0.9;
const DAYS_PER_MONTH = 30.44;
const round = (n: number): number => Math.round(n * 100) / 100;

/** Contributions are signed: a withdrawal is a negative row, so funded is just their sum. */
const fundedFrom = (contributions: SavingsGoalContributionRow[]): number =>
  round(contributions.reduce((total, c) => total + c.amount, 0));

/**
 * The rate a goal has actually been funded at, per month.
 *
 * Measured from the first contribution rather than from the day the goal was created: a goal set
 * up in January and first funded in June has been running for one month, not six, and dividing by
 * six reports a saver who is on track as badly behind.
 *
 * The opening deposit is **excluded from the numerator**, because it did not accrue over the
 * window it opens. Counting it divides N deposits by the N-1 intervals between them, overstating
 * the rate by N/(N-1): 10,000 on day 0 and 10,000 on day 30 is a 10,000 monthly transfer, and the
 * unadjusted sum called it 20,293 a month. That is not cosmetic - it flows into the on-track test,
 * so a saver putting away 5,000 against a required 8,227 read as on track and the `goal-off-pace`
 * finding this feature exists for never fired.
 *
 * Null until a **second** contribution exists on a later day. One deposit is an amount and not a
 * rate - which this always claimed and enforced as `elapsed < 1`, so a lone deposit read a day
 * later reported 304,400 a month. `paceOf` reads that null as `underway`, never as `stalled`.
 */
const observedMonthlyRate = (
  contributions: SavingsGoalContributionRow[],
  today: string,
): number | null => {
  if (contributions.length < 2) return null;
  const sorted = [...contributions].sort((a, b) => a.date.localeCompare(b.date));
  const elapsed = daysBetween(sorted[0].date, today);
  if (elapsed < 1) return null;
  const sinceFirst = fundedFrom(sorted) - sorted[0].amount;
  return round((sinceFirst / elapsed) * DAYS_PER_MONTH);
};

/**
 * Whether a goal will arrive on time, and what it would take.
 *
 * `requiredMonthly` is what is left divided by the months left - the answer to "what should I be
 * putting in". `projectedCompletion` runs the observed rate forward instead, which is the answer
 * to "what will actually happen"; the two disagreeing is the whole finding.
 *
 * A goal with no `targetDate` gets progress and nothing else. Pace against no deadline is not a
 * conservative estimate, it is a category error, and returning a reassuring "on track" for it
 * would be the worst of the available answers.
 */
const paceOf = (goal: GoalFacts, funded: number, today: string): SavingsGoalPace => {
  const remaining = round(Math.max(0, goal.targetAmount - funded));
  const observedMonthly = observedMonthlyRate(goal.contributions, today);
  const base = {
    remaining,
    observedMonthly,
    requiredMonthly: null,
    daysRemaining: null,
    projectedCompletion: null,
    state: "no-deadline" as SavingsGoalPace["state"],
  };

  if (remaining === 0) return { ...base, state: "funded" };
  if (goal.targetDate === null) return base;

  const daysRemaining = daysBetween(today, goal.targetDate);
  // Past its date and still short. "Behind" understates a deadline that has already gone.
  if (daysRemaining <= 0) {
    return { ...base, daysRemaining, requiredMonthly: null, state: "overdue" };
  }

  const requiredMonthly = round((remaining / daysRemaining) * DAYS_PER_MONTH);

  // Nothing has gone in, or it has all come back out. `stalled` is gated on the funded amount and
  // not on a missing rate: those are different facts, and conflating them put "has nothing put
  // aside yet" and a "Not started" badge on a goal the user had funded that morning.
  if (funded <= 0) {
    return { ...base, daysRemaining, requiredMonthly, projectedCompletion: null, state: "stalled" };
  }

  // Money is going in and there is not yet enough of it, on enough days, to state a rate. Neutral
  // on purpose, the way `no-deadline` is: inventing a rate here would invent the only figure the
  // caller reads, and there is nothing for the user to act on either way.
  if (observedMonthly === null) {
    return { ...base, daysRemaining, requiredMonthly, projectedCompletion: null, state: "underway" };
  }

  // A measured rate of zero or less is a real finding, not a missing one: the goal holds money and
  // has stopped growing, so it arrives on no date at all. `behind` without a projection.
  if (observedMonthly <= 0) {
    return { ...base, daysRemaining, requiredMonthly, projectedCompletion: null, state: "behind" };
  }

  const daysToFinish = Math.ceil((remaining / observedMonthly) * DAYS_PER_MONTH);
  const completion = parseDay(today);
  completion.setUTCDate(completion.getUTCDate() + daysToFinish);
  return {
    ...base,
    daysRemaining,
    requiredMonthly,
    projectedCompletion: completion.toISOString().slice(0, 10),
    state: observedMonthly >= requiredMonthly * PACE_TOLERANCE ? "on-track" : "behind",
  };
};

/** Everything the UI and the Watchlist read about one goal. */
export const summariseGoal = (goal: GoalFacts, today: string): SavingsGoalSummary => {
  const funded = fundedFrom(goal.contributions);
  return {
    id: goal.id,
    name: goal.name,
    kind: goal.kind,
    status: goal.status,
    targetAmount: round(goal.targetAmount),
    targetDate: goal.targetDate,
    notes: goal.notes,
    funded,
    // Clamped at 100 for the bar's sake; `funded` keeps the real figure, so an over-funded goal is
    // still visible as one rather than silently rounded down to its target.
    fundedPct: goal.targetAmount <= 0 ? 0 : Math.min(100, Math.round((funded / goal.targetAmount) * 100)),
    lastContributedOn: goal.contributions.length === 0
      ? null
      : goal.contributions.map((c) => c.date).sort().at(-1) ?? null,
    contributionCount: goal.contributions.length,
    pace: paceOf(goal, funded, today),
  };
};

const toGoalFacts = (
  goal: {
    id: string;
    name: string;
    kind: string;
    status: string;
    targetAmount: number;
    targetDate: Date | null;
    notes: string | null;
    createdAt: Date;
    contributions: Array<{ id: string; amount: number; date: Date; note: string | null }>;
  },
  timezoneOffset: number,
): GoalFacts => ({
  id: goal.id,
  name: goal.name,
  kind: goal.kind as GoalFacts["kind"],
  status: goal.status as GoalFacts["status"],
  targetAmount: goal.targetAmount,
  targetDate: goal.targetDate ? formatLocalDate(goal.targetDate, timezoneOffset) : null,
  notes: goal.notes,
  createdOn: formatLocalDate(goal.createdAt, timezoneOffset),
  contributions: goal.contributions.map((c) => ({
    id: c.id,
    amount: c.amount,
    date: formatLocalDate(c.date, timezoneOffset),
    note: c.note,
  })),
});

const goalSelect = {
  id: true,
  name: true,
  kind: true,
  status: true,
  targetAmount: true,
  targetDate: true,
  notes: true,
  createdAt: true,
  contributions: { select: { id: true, amount: true, date: true, note: true } },
} as const;

/**
 * Every goal the user has, summarised.
 *
 * Contributions come back in full rather than aggregated in SQL: a personal set of goals holds
 * tens of rows, and the rate arithmetic needs the days they landed on, not their sum.
 */
export const getSavingsGoals = async (
  prisma: PrismaClient,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<SavingsGoalSummary[]> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezoneOffset: true } });
  const timezoneOffset = user?.timezoneOffset ?? 0;
  const today = formatLocalDate(new Date(), timezoneOffset);

  const goals = await prisma.savingsGoal.findMany({
    where: { userId, ...(options.includeArchived ? {} : { status: { not: "ARCHIVED" as const } }) },
    select: goalSelect,
    orderBy: [{ status: "asc" }, { targetDate: "asc" }, { createdAt: "asc" }],
  });

  return goals.map((goal) => summariseGoal(toGoalFacts(goal, timezoneOffset), today));
};

/** One goal, or null when it is not this user's. Ownership is the `where`, never a check after. */
export const getSavingsGoal = async (
  prisma: PrismaClient,
  userId: string,
  goalId: string,
): Promise<SavingsGoalSummary | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezoneOffset: true } });
  const timezoneOffset = user?.timezoneOffset ?? 0;
  const goal = await prisma.savingsGoal.findFirst({ where: { id: goalId, userId }, select: goalSelect });
  if (!goal) return null;
  return summariseGoal(toGoalFacts(goal, timezoneOffset), formatLocalDate(new Date(), timezoneOffset));
};

/**
 * A bare date is midnight UTC, which is the previous day for anyone west of Greenwich.
 *
 * The same `Date.UTC(y, m, d) + tzOffset * 60000` the rest of the app uses for every day and month
 * boundary. A target date stored a day early moves every pace figure that reads it.
 */
export const goalDayToInstant = (day: string, timezoneOffset: number): Date =>
  new Date(parseDay(day).getTime() + timezoneOffset * 60_000);

export const buildGoalData = (input: SavingsGoalInput, timezoneOffset: number) => ({
  name: input.name,
  kind: input.kind,
  targetAmount: input.targetAmount,
  targetDate: input.targetDate ? goalDayToInstant(input.targetDate, timezoneOffset) : null,
  notes: input.notes ?? null,
});
