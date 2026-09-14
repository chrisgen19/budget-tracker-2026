import type { Prisma, TransactionType } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";
import { CARD_PAYMENT_CATEGORY_NAME } from "@/lib/default-categories";

/** Why a transaction may not carry the credit card it names. */
export type CardPaymentRefusal =
  /** The card is not this user's, or does not exist. Not distinguished, so ids cannot be probed. */
  | "ACCOUNT_NOT_FOUND"
  /** The card is archived. Its history stays, but nothing new may be paid against it. */
  | "ACCOUNT_ARCHIVED"
  /** Only an expense can pay a card down. */
  | "NOT_AN_EXPENSE"
  /** A card payment must be filed under the default payment category. */
  | "NOT_PAYMENT_CATEGORY";

export const CARD_PAYMENT_REFUSAL_MESSAGES: Record<CardPaymentRefusal, string> = {
  ACCOUNT_NOT_FOUND: "That credit card does not exist",
  ACCOUNT_ARCHIVED:
    "That credit card is archived. Reactivate it before recording a payment against it",
  NOT_AN_EXPENSE: "Only an expense can pay down a credit card",
  NOT_PAYMENT_CATEGORY: `A credit card payment has to use the "${CARD_PAYMENT_CATEGORY_NAME}" category`,
};

export interface CardPaymentCandidate {
  creditAccountId?: string | null;
  categoryId: string;
  type: TransactionType;
}

/**
 * The single rule for a transaction that pays down a credit card.
 *
 * A linked row is an ordinary expense everywhere expenses are counted, and it also lowers what the
 * card says is owed. Both halves only stay true together if the row is an expense, filed under the
 * payment category, against a card the caller owns and has not archived. A payment filed under
 * Groceries would put the same money in two categories: once through the card's own breakdown of
 * the charges it settles, and again in the dashboard's.
 *
 * Returns null when every item may carry its link, and when no item names one. Nothing is queried
 * in that case, so the ordinary create and edit paths pay nothing for this check.
 *
 * Not locked. The race it leaves is a card archived between this read and the write, which records
 * one payment against a card that was just switched off: still a real payment of a real debt, and
 * visible on the archived card's page.
 */
export const checkCardPayments = async (
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  items: readonly CardPaymentCandidate[]
): Promise<CardPaymentRefusal | null> => {
  const linked = items.flatMap((item) =>
    item.creditAccountId ? [{ ...item, creditAccountId: item.creditAccountId }] : []
  );
  if (linked.length === 0) return null;
  if (linked.some((item) => item.type !== "EXPENSE")) return "NOT_AN_EXPENSE";

  const accountIds = [...new Set(linked.map((item) => item.creditAccountId))];
  const accounts = await db.creditAccount.findMany({
    where: { id: { in: accountIds }, userId },
    select: { id: true, isActive: true },
  });
  if (accounts.length !== accountIds.length) return "ACCOUNT_NOT_FOUND";
  if (accounts.some((account) => !account.isActive)) return "ACCOUNT_ARCHIVED";

  const categoryIds = [...new Set(linked.map((item) => item.categoryId))];
  const paymentCategories = await db.category.findMany({
    where: {
      id: { in: categoryIds },
      userId: null,
      isDefault: true,
      name: CARD_PAYMENT_CATEGORY_NAME,
      type: "EXPENSE",
    },
    select: { id: true },
  });
  if (paymentCategories.length !== categoryIds.length) return "NOT_PAYMENT_CATEGORY";

  return null;
};
