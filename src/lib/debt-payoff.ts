import { clampToMonth, utcDayKey } from "@/lib/bill-dates";

/**
 * What it costs to carry a credit card balance, and when it clears.
 *
 * Pure, with no Prisma import, so the arithmetic is unit-tested without a database -- the same
 * shape as `savings-goals.ts` and `card-owed.ts`. Everything here is a **projection**, and every
 * caller is expected to label it as one: it assumes no further purchases on the card, which is the
 * one assumption most likely to be wrong.
 */

/** Fifty years. Past this the answer is "not in any useful sense", not a number of months. */
const MAX_MONTHS = 600;

/** Below this the balance is settled; floating-point remainders are not a debt. */
const SETTLED = 0.005;

export interface DebtTerms {
  /** What the card owes today. Zero or negative means nothing to pay off. */
  balance: number;
  /** Annual rate as a percentage. `0` is a real 0% plan; null is handled before this is built. */
  apr: number;
  minimumPct: number | null;
  minimumFloor: number | null;
}

/** Why a projection could not be made. Each one sends the reader somewhere different. */
export type PayoffUnknownReason =
  /** No APR recorded. Nothing can be projected, and this is the only reason the card can fix. */
  | "no-apr"
  /** Neither minimum column is set, so there is no minimum to project. */
  | "no-minimum"
  /** Too few payments logged to average what is actually being paid. */
  | "too-little-history"
  /** No planned payment has been set. */
  | "not-planned";

export type PayoffOutcome =
  | { status: "settled" }
  | { status: "clears"; months: number; payoffDate: string; totalInterest: number }
  /** The payment never exceeds the interest, so the balance does not fall. Not a month count. */
  | { status: "never-clears" }
  /** It falls, but not within `MAX_MONTHS`. Distinct from never: the arithmetic does terminate. */
  | { status: "beyond-horizon" }
  | { status: "unknown"; reason: PayoffUnknownReason };

/**
 * The minimum due on a balance: the greater of a percentage of it and a fixed floor.
 *
 * Both columns are optional and either alone is usable. Returns null only when neither is set,
 * which is "no minimum is known" rather than "the minimum is nothing".
 *
 * The floor is not applied once the balance is below it: a card owing 200 against a 500 floor is
 * billed the 200, not more than it owes.
 */
export const minimumDue = (
  balance: number,
  minimumPct: number | null,
  minimumFloor: number | null
): number | null => {
  if (minimumPct === null && minimumFloor === null) return null;
  const fromPct = minimumPct === null ? 0 : (balance * minimumPct) / 100;
  const fromFloor = minimumFloor ?? 0;
  return Math.min(balance, Math.max(fromPct, fromFloor));
};

/** The same calendar day `months` later, clamped into a shorter month (31 Jan + 1 = 28/29 Feb). */
const addMonths = (from: Date, months: number): Date => {
  const target = from.getUTCMonth() + months;
  return clampToMonth(
    from.getUTCFullYear() + Math.floor(target / 12),
    ((target % 12) + 12) % 12,
    from.getUTCDate()
  );
};

/**
 * Walk the balance forward a month at a time until it clears.
 *
 * `paymentFor` is handed the balance at the start of each month, so a minimum that is a percentage
 * of the outstanding balance falls as the balance does -- which is exactly why a single flat
 * minimum cannot stand in for one, and why this takes a function rather than an amount.
 *
 * Interest is charged on the balance *before* the payment lands. That is the pessimistic reading of
 * a billing cycle and the right one to show someone deciding what to pay: a card that posts the
 * payment first costs less than this says, never more.
 */
const walk = (
  terms: DebtTerms,
  paymentFor: (balance: number) => number | null,
  from: Date
): PayoffOutcome => {
  if (terms.balance <= SETTLED) return { status: "settled" };

  const monthlyRate = terms.apr / 100 / 12;
  let balance = terms.balance;
  let totalInterest = 0;

  for (let month = 1; month <= MAX_MONTHS; month += 1) {
    const payment = paymentFor(balance);
    if (payment === null) return { status: "unknown", reason: "no-minimum" };

    const interest = balance * monthlyRate;
    const owed = balance + interest;
    const paid = Math.min(payment, owed);
    const next = owed - paid;

    // No progress this month means no progress in any later one: the payment is either fixed, or
    // a percentage of a balance that is not falling. Reporting 600 months would be a made-up figure.
    if (next >= balance) return { status: "never-clears" };

    totalInterest += interest;
    balance = next;

    if (balance <= SETTLED) {
      return {
        status: "clears",
        months: month,
        payoffDate: utcDayKey(addMonths(from, month)),
        totalInterest: Math.round(totalInterest * 100) / 100,
      };
    }
  }

  return { status: "beyond-horizon" };
};

/** Paying only what the bank asks each month. The worst case, and often the one that never ends. */
export const payoffOnMinimum = (terms: DebtTerms, from: Date): PayoffOutcome => {
  if (minimumDue(terms.balance, terms.minimumPct, terms.minimumFloor) === null) {
    return { status: "unknown", reason: "no-minimum" };
  }
  return walk(terms, (balance) => minimumDue(balance, terms.minimumPct, terms.minimumFloor), from);
};

/** Paying a fixed amount every month: an observed average, or a planned figure. */
export const payoffOnFixedPayment = (
  terms: DebtTerms,
  monthly: number | null,
  from: Date,
  reason: PayoffUnknownReason
): PayoffOutcome => {
  if (monthly === null) return { status: "unknown", reason };
  if (monthly <= 0) return terms.balance <= SETTLED ? { status: "settled" } : { status: "never-clears" };
  return walk(terms, () => monthly, from);
};

/** How many months of payment history `observedMonthlyPayment` needs before it will answer. */
export const MIN_PAYMENTS_FOR_AVERAGE = 3;

/**
 * What is actually being paid each month, averaged over the payments supplied.
 *
 * The caller passes **`PAYMENT` rows only**. A `CREDIT` is a refund the card issued, not a payment
 * the user chose to make, and averaging one in overstates what they are putting against the card.
 *
 * Null below `MIN_PAYMENTS_FOR_AVERAGE`: one or two payments is not a habit, and projecting a
 * payoff date off a single transfer would present an accident as a plan. The divisor is the number
 * of **months in the window**, not the number of payments, so two payments in one month and one in
 * the next average to what was really being paid per month rather than to a single payment's size.
 */
export const observedMonthlyPayment = (
  payments: readonly { amount: number }[],
  monthsInWindow: number
): number | null => {
  if (payments.length < MIN_PAYMENTS_FOR_AVERAGE || monthsInWindow <= 0) return null;
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  return Math.round((total / monthsInWindow) * 100) / 100;
};

export interface PayoffComparison {
  minimum: PayoffOutcome;
  observed: PayoffOutcome;
  planned: PayoffOutcome;
  /** What the observed average worked out to, so the UI can show the figure behind the column. */
  observedMonthly: number | null;
}

/**
 * The three bases side by side: what the bank asks, what is actually being paid, and what was
 * planned. Shown together because the useful reading is the gap between them.
 *
 * Every one requires an APR. Without it the whole comparison is withheld rather than computed at
 * 0%, which is the rule the rest of the app applies to a missing opening balance and to a goal
 * with no target date: a figure nobody supplied is not a figure.
 */
export const comparePayoffs = ({
  balance,
  apr,
  minimumPct,
  minimumFloor,
  plannedPayment,
  observedMonthly,
  from,
}: {
  balance: number;
  apr: number | null;
  minimumPct: number | null;
  minimumFloor: number | null;
  plannedPayment: number | null;
  observedMonthly: number | null;
  from: Date;
}): PayoffComparison => {
  if (apr === null) {
    const unknown = { status: "unknown", reason: "no-apr" } as const;
    return { minimum: unknown, observed: unknown, planned: unknown, observedMonthly };
  }

  const terms: DebtTerms = { balance, apr, minimumPct, minimumFloor };
  return {
    minimum: payoffOnMinimum(terms, from),
    observed: payoffOnFixedPayment(terms, observedMonthly, from, "too-little-history"),
    planned: payoffOnFixedPayment(terms, plannedPayment, from, "not-planned"),
    observedMonthly,
  };
};
