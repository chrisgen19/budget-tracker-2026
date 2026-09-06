/**
 * What a variable bill is likely to cost next.
 *
 * A bill's `amount` is one number doing two jobs: what the reminder asserts you
 * owe, and what the forecast expects you to pay. For a fixed bill those are the
 * same figure. For a metered one they are not -- Meralco swung 2.7x across a
 * single year, and its budgeted figure was within 150 of what cool months cost
 * while being 8,600 short in June. No constant is right (#217).
 *
 * So a variable bill's forecast comes from its own payment history instead.
 * Pure and dependency-free: callers pass the payments they already loaded.
 */

/** How a figure was arrived at, so the UI can say "estimated" rather than assert. */
export type EstimateBasis = "same-month-last-year" | "last-payment" | "budgeted";

export type BillEstimate = {
  amount: number;
  basis: EstimateBasis;
  /** How many payments the figure was derived from. Zero for "budgeted". */
  sampleSize: number;
};

/**
 * A payment, as the estimator sees it.
 *
 * `at` is the raw instant. Year and month alone tie for two payments in the same
 * month, and "the last payment" would then depend on the order the caller
 * happened to fetch in -- which for a bill paid twice in a month is exactly the
 * case where the two figures differ.
 */
export type EstimateSample = { month: number; year: number; amount: number; at: number };

/**
 * Estimate the next payment for a bill due in `dueMonth` of `dueYear`.
 *
 * Prefers the **same month a year ago**, which is the only basis that survives a
 * seasonal bill: an annual mean is wrong in both directions every single month,
 * high through the cool season and low through summer.
 *
 * With less than a year of history it falls back to the **most recent payment**,
 * not to a mean of several. Adjacent months of a metered bill resemble each
 * other; a mean spanning a seasonal swing resembles no month at all. Meralco
 * makes the case: forecasting a cool October, a six-payment mean gives 8,919
 * because it drags the June peak of 14,126 across the whole year, while
 * September's actual 5,990 is within a few hundred of what October will cost.
 * The mean is smoother and wrong; the last reading is noisier and close.
 *
 * A bill with no payments at all falls back to the budgeted figure -- always
 * reported as such, since a caller that cannot tell an estimate from an
 * assertion will print a guess as though it were a bill.
 *
 * @param samples   every payment linked to the bill, in the user's calendar months
 * @param dueMonth  1-12, the month being forecast
 * @param dueYear   calendar year of the due date
 * @param budgeted  the bill's stored amount, used only when nothing else exists
 */
export const estimateBillAmount = (
  samples: readonly EstimateSample[],
  dueMonth: number,
  dueYear: number,
  budgeted: number,
): BillEstimate => {
  if (samples.length === 0) {
    return { amount: budgeted, basis: "budgeted", sampleSize: 0 };
  }

  // Same month in any earlier year, newest first. Two years of a hot June beat
  // one, and averaging them is steadier than trusting a single reading.
  const sameMonth = samples.filter((s) => s.month === dueMonth && s.year < dueYear);
  if (sameMonth.length > 0) {
    return {
      amount: mean(sameMonth.map((s) => s.amount)),
      basis: "same-month-last-year",
      sampleSize: sameMonth.length,
    };
  }

  const newest = [...samples].sort((a, b) => b.at - a.at)[0];
  return { amount: Math.round(newest.amount), basis: "last-payment", sampleSize: 1 };
};

/** Rounded to whole currency units: a forecast to the centavo is false precision. */
const mean = (xs: readonly number[]): number =>
  Math.round(xs.reduce((sum, x) => sum + x, 0) / xs.length);

/** Human-readable note for the basis, for a UI that must not assert a guess. */
export const describeEstimateBasis = (e: BillEstimate): string => {
  switch (e.basis) {
    case "same-month-last-year":
      return e.sampleSize > 1
        ? `average of this month across ${e.sampleSize} previous years`
        : "what this month cost last year";
    case "last-payment":
      return "what it cost last time — too little history to see a year yet";
    case "budgeted":
      return "the amount set on the bill — no payments recorded yet";
  }
};

/**
 * Build estimator samples from a bill's payments and its settled occurrences.
 *
 * The seasonal month is the **occurrence's** due date, not the day the payment
 * happened. A bill due 1 September and paid on 31 August belongs to September's
 * billing period; filing it under August means next September finds no same-month
 * history and drops to the last-payment fallback. This is not hypothetical --
 * one account has an April occurrence settled by a 27 March payment.
 *
 * The transaction's instant is still what `at` carries, since ordering "the last
 * payment" is a question about when money moved, not about which period it was
 * for. A payment settling no occurrence falls back to its own calendar month.
 *
 * Shared by every caller rather than repeated: the same estimate computed two
 * ways in two files is the drift this feature has already been caught by.
 */
export const buildEstimateSamples = (
  payments: readonly { id: string; date: Date; amount: number }[],
  settledOccurrences: readonly { dueDate: Date; transactionId: string | null }[],
  timezoneOffsetMinutes: number,
): EstimateSample[] => {
  const periodOf = new Map<string, Date>();
  for (const o of settledOccurrences) {
    if (o.transactionId) periodOf.set(o.transactionId, o.dueDate);
  }
  const tzMs = timezoneOffsetMinutes * 60 * 1000;

  return payments.map((p): EstimateSample => {
    const occurrence = periodOf.get(p.id);
    // A due date is date-only at UTC midnight and means "the 5th" for everyone,
    // so its month is read in UTC. A payment instant is resolved to the user's
    // calendar month, which is the other half of the same rule.
    const period = occurrence ?? new Date(p.date.getTime() - tzMs);
    return {
      year: period.getUTCFullYear(),
      month: period.getUTCMonth() + 1,
      amount: p.amount,
      at: p.date.getTime(),
    };
  });
};
