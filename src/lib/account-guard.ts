import type { PrismaClient } from "@/lib/budget-query-types";

/**
 * True when every id given is an active account belonging to this user.
 *
 * Shared by the three write paths (`POST /api/transactions`, its `PUT`, and
 * `createTransactionBatch`) rather than reimplemented in each, which is how the category check
 * came to exist in only one of them.
 *
 * The foreign key proves an account *exists*, not whose it is, so without this a caller supplying
 * someone else's id would move a stranger's balance. Not hypothetical once ids arrive from a model
 * over `/api/mcp`. Archived accounts are refused for a different reason: archiving is how an
 * account is retired, since deleting one would `SetNull` every row that referenced it and silently
 * rewrite history, so writing to an archived account would quietly bring it back into balances.
 */
export const accountIdsAreUsable = async (
  prisma: PrismaClient,
  userId: string,
  ids: Array<string | null | undefined>
): Promise<boolean> => {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return true;

  const usable = await prisma.account.count({
    where: { id: { in: unique }, userId, isActive: true },
  });
  return usable === unique.length;
};
