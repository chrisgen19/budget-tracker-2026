/**
 * Pure matching rules shared by the bill repair scripts.
 *
 * Deliberately import-safe: it constructs no Prisma client and runs nothing at
 * module scope, so a test may import it without opening a database connection.
 * The CLI entry points that use it self-execute and are never imported, which is
 * the same split `database-url.ts` already follows.
 */

/**
 * Whether a bill's description is specific enough to find its payments by.
 *
 * Matching unlinked payments on description is what catches the ones entered by
 * hand, but the description does not have to be unique: `description` defaults
 * to "" in the schema, and nothing stops one account naming two bills alike.
 * Either case makes a single transaction match several bills, and since every
 * plan is built before any write lands, the same payment could be handed to
 * occurrences of two different bills -- each write overwriting the previous
 * `billId`, leaving every log but the last pointing at a payment now owned by
 * another bill.
 *
 * Ambiguous descriptions are therefore not matched on at all. Such a bill is
 * still repaired through payments already carrying its `billId`, and anything
 * else is reported rather than guessed.
 *
 * @param description       the bill's own description
 * @param siblingDescriptions descriptions of every bill belonging to the *same
 *   user*, including this one. Scoped per user because the payment query is:
 *   two unrelated accounts both having a "Rent" bill makes neither ambiguous.
 */
export const descriptionCanMatch = (
  description: string,
  siblingDescriptions: readonly string[],
): boolean => {
  const key = description.trim().toLowerCase();
  if (key === "") return false;
  return siblingDescriptions.filter((d) => d.trim().toLowerCase() === key).length === 1;
};
