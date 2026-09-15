const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * What the cards owe together, archived ones included, or null when there is nothing to show.
 *
 * Deleting a card with any history archives it whatever it still owes, so leaving archived cards out
 * would drop real debt from the total. Null only when no card is active and no archived one carries
 * a balance, which is when the total is hidden.
 *
 * Its own module with no imports, so the Cards page and the dashboard route count the same way
 * without pulling Prisma into the browser bundle.
 */
export const sumOwedOnCards = (cards: readonly { isActive: boolean; balance: number }[]): number | null => {
  if (!cards.some((card) => card.isActive || card.balance !== 0)) return null;
  return round2(cards.reduce((sum, card) => sum + card.balance, 0));
};
