/**
 * Interest and fees charged on a credit card.
 *
 * These are an ordinary EXPENSE transaction carrying `credit_account_id`, exactly like a purchase,
 * because the money genuinely left. Deliberately *not* a new row type that raises the balance
 * outside `transactions`: that was the first version of credit cards (#318, `credit_charges`), and
 * it hid card spending from every category and label report until #323 undid it.
 *
 * They are told apart from purchases by their category alone, so no column and no migration.
 */

/**
 * The seeded category interest and fees are filed under.
 *
 * Matched by name rather than by id so a user's own same-named category counts too, and so nothing
 * has to look an id up before it can ask the question. `default-categories.ts` seeds it; a database
 * seeded before it was added does not have it until `pnpm db:seed` is run again, which is why every
 * caller here handles its absence rather than assuming it.
 */
export const INTEREST_CATEGORY_NAME = "Interest & Fees";

/** What the card page needs to describe interest on one card in one month. */
export interface CardInterestFacts {
  /** Interest and fees charged on this card within the month on screen. */
  period: number;
  /** Whether any interest row has *ever* been logged on this card, in any month. */
  everLogged: boolean;
}

export type CardInterestState =
  /** Nothing has ever been logged, so the balance is drifting and we must not claim a figure. */
  | { state: "untracked" }
  /** Interest has been logged before, just not in this month. This zero is a real zero. */
  | { state: "none-this-period" }
  | { state: "charged"; amount: number };

/**
 * Untracked and zero are different answers and must not render alike.
 *
 * A card that has never had interest logged shows "0" as though it costs nothing to carry, which is
 * the opposite of true for a card carrying a balance: the interest is being charged by the bank
 * either way, and what is missing is the record of it. Only a card with some interest history can
 * honestly report a month with none.
 */
export const describeCardInterest = ({ period, everLogged }: CardInterestFacts): CardInterestState => {
  if (!everLogged) return { state: "untracked" };
  // Non-zero rather than positive: a refunded fee leaves the month net negative, and that is a
  // month where something happened. Reporting it as "none" would hide the refund entirely.
  return period !== 0 ? { state: "charged", amount: period } : { state: "none-this-period" };
};

/**
 * What share of a card's limit is currently used, as a percentage.
 *
 * `null` when there is no limit to measure against, and when the limit is zero: a card whose limit
 * is nothing has no meaningful ratio, and dividing by it would report `Infinity` as a figure.
 *
 * Deliberately **not clamped to 100**. Being over the limit is the single most useful thing this
 * number can say, and a clamp would render it identically to sitting exactly on it. A negative
 * balance (the card holds a credit) likewise reports below zero rather than being floored.
 */
export const utilizationOf = (balance: number, creditLimit: number | null): number | null => {
  if (creditLimit === null || creditLimit === 0) return null;
  return Math.round((balance / creditLimit) * 1000) / 10;
};

/** One card's contribution to the portfolio ratio. Archived cards count: they still owe. */
export interface UtilizationCard {
  balance: number;
  creditLimit: number | null;
}

export interface OverallUtilization {
  /** Total balance over total limit, as a percentage, across the counted cards only. */
  percent: number;
  /** How many cards the ratio covers. */
  counted: number;
  /** How many cards were left out of both sides for having no usable limit. */
  omitted: number;
}

/**
 * Utilization across every card at once, which is the figure a scoring model actually reads.
 *
 * Not the mean of each card's percentage, and not the worst card. A portfolio ratio is one sum over
 * another: two cards at 10% of 100,000 and 90% of 1,000 are nowhere near 50% used, and averaging
 * the percentages says they are.
 *
 * **Cards with no usable limit are dropped from both sides, never from one.** This is the whole of
 * the arithmetic worth getting right. Summing every balance while summing only the known limits
 * inflates the ratio, and it inflates it in the dangerous direction: utilization is a number people
 * act on, so reporting a portfolio as worse used than it is provokes a payment that was not needed.
 * The count of what was left out rides along so the UI can say which cards the figure covers rather
 * than implying it covers them all.
 *
 * `null` when no card carries a limit, for the same reason `utilizationOf` is: that is a question
 * the data cannot answer, and 0% is an answer.
 */
export const overallUtilizationOf = (cards: readonly UtilizationCard[]): OverallUtilization | null => {
  // The same test `utilizationOf` applies per card, so the two cannot disagree about which cards
  // are measurable: a zero limit divides to Infinity there and must not be summed into a total here.
  const measurable = cards.filter((card) => card.creditLimit !== null && card.creditLimit !== 0);
  if (measurable.length === 0) return null;

  const limit = measurable.reduce((sum, card) => sum + (card.creditLimit ?? 0), 0);
  // Every limit negative would divide by a negative total and flip the sign of a real ratio. No
  // card should have one, and a figure that inverts under bad data is worse than no figure.
  if (limit <= 0) return null;

  const balance = measurable.reduce((sum, card) => sum + card.balance, 0);
  return {
    percent: Math.round((balance / limit) * 1000) / 10,
    counted: measurable.length,
    omitted: cards.length - measurable.length,
  };
};
