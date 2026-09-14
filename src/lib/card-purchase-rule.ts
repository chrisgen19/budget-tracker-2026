import type { Prisma, TransactionType } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";

/** Why a transaction may not be paid with the credit card it names. */
export type CardPurchaseRefusal =
  /** The card is not this user's, or does not exist. Not distinguished, so ids cannot be probed. */
  | "ACCOUNT_NOT_FOUND"
  /** The card is archived, and the link is new. Its existing purchases stay editable. */
  | "ACCOUNT_ARCHIVED"
  /** Only spending can be paid with a card. */
  | "NOT_AN_EXPENSE";

export const CARD_PURCHASE_REFUSAL_MESSAGES: Record<CardPurchaseRefusal, string> = {
  ACCOUNT_NOT_FOUND: "That credit card does not exist",
  ACCOUNT_ARCHIVED: "That credit card is archived. Reactivate it before adding purchases to it",
  NOT_AN_EXPENSE: "Only an expense can be paid with a credit card",
};

export interface CardPurchaseCandidate {
  creditAccountId?: string | null;
  type: TransactionType;
  /**
   * The card the row carried before this write, when it is an edit. A link that does not move is
   * not judged on the card still being active, so a purchase on a card archived since stays
   * editable, down to a typo in its description.
   */
  storedCreditAccountId?: string | null;
}

/**
 * The single rule for a transaction paid with a credit card.
 *
 * A linked row is an ordinary expense everywhere, and it also adds to what the card owes. That only
 * makes sense for spending on a card the caller owns. An archived card takes no new purchases.
 *
 * Returns null when every item may carry its link, and when no item names one. Nothing is queried
 * in that case, so the ordinary create and edit paths pay nothing for this check.
 *
 * Not locked. The race it leaves is a card archived between this read and the write, which records
 * one real purchase against a card that was just switched off, visible on that card's page.
 */
export const checkCardPurchases = async (
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  items: readonly CardPurchaseCandidate[]
): Promise<CardPurchaseRefusal | null> => {
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

  const archived = new Set(accounts.filter((account) => !account.isActive).map((a) => a.id));
  const newOnArchived = linked.some(
    (item) => archived.has(item.creditAccountId) && item.storedCreditAccountId !== item.creditAccountId
  );
  return newOnArchived ? "ACCOUNT_ARCHIVED" : null;
};
