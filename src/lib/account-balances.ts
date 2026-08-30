import type {
  PrismaClient,
  AccountBalance,
  AccountBalancesParams,
} from "@/lib/budget-query-types";

/**
 * Balances for every account, derived from the transactions themselves.
 *
 * Never stored. Rows here are edited, deleted, backdated, and created days after the fact by
 * receipt scanning, so an incrementally maintained running total drifts and nothing in the app
 * would notice it had. Recomputing is four grouped aggregates over an indexed column, which is
 * cheap at any size a personal budget reaches.
 *
 * One signed convention throughout: positive is money you have, negative is money you owe. A
 * credit card is not a special case in the arithmetic, only in how it is *presented* — see
 * `outstanding`. That is deliberate: two sign conventions in the data would mean every future
 * caller has to remember which one it is holding.
 *
 * The four sums are the whole model:
 *
 *     balance = openingBalance
 *             + INCOME   on the account          (money arrives)
 *             - EXPENSE  on the account          (money leaves)
 *             - TRANSFER out of the account      (money leaves, accountId side)
 *             + TRANSFER into the account        (money arrives, transferAccountId side)
 *
 * A card purchase is an EXPENSE on the card, pushing the balance further negative. Paying the
 * card bill is a TRANSFER out of checking and into the card, which brings it back toward zero
 * without ever touching a spending category. That is the double-count fixed at the level of the
 * arithmetic rather than by asking the user to log one of the two events and not the other.
 */
export const getAccountBalances = async (
  prisma: PrismaClient,
  userId: string,
  params: AccountBalancesParams = {}
): Promise<AccountBalance[]> => {
  const accounts = await prisma.account.findMany({
    where: { userId, ...(params.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  if (accounts.length === 0) return [];

  // An `asOf` day is inclusive to its last instant, matching `resolvePeriod` in budget-queries:
  // resolving it to midnight would silently drop everything that happened on the day asked for.
  const upTo = params.asOf
    ? {
        date: {
          lte: new Date(
            Date.UTC(
              Number(params.asOf.slice(0, 4)),
              Number(params.asOf.slice(5, 7)) - 1,
              Number(params.asOf.slice(8, 10)),
              23,
              59,
              59,
              999
            ) +
              (params.timezoneOffset ?? 0) * 60_000
          ),
        },
      }
    : {};

  const ids = accounts.map((a) => a.id);

  // Grouped in the database rather than by pulling rows back and reducing: a year of transactions
  // is a large payload to move in order to produce four numbers per account.
  const [bySourceType, transfersIn] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["accountId", "type"],
      where: { userId, accountId: { in: ids }, ...upTo },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["transferAccountId"],
      where: {
        userId,
        transferAccountId: { in: ids },
        type: "TRANSFER",
        ...upTo,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const sourceKey = (accountId: string, type: string) => `${accountId}:${type}`;
  const sums = new Map<string, { amount: number; count: number }>();
  for (const g of bySourceType) {
    if (!g.accountId) continue;
    sums.set(sourceKey(g.accountId, g.type), {
      amount: g._sum.amount ?? 0,
      count: g._count._all,
    });
  }

  const inbound = new Map<string, { amount: number; count: number }>();
  for (const g of transfersIn) {
    if (!g.transferAccountId) continue;
    inbound.set(g.transferAccountId, {
      amount: g._sum.amount ?? 0,
      count: g._count._all,
    });
  }

  return accounts.map((account) => {
    const income = sums.get(sourceKey(account.id, "INCOME"));
    const expense = sums.get(sourceKey(account.id, "EXPENSE"));
    const transferOut = sums.get(sourceKey(account.id, "TRANSFER"));
    const transferIn = inbound.get(account.id);

    const inflow = (income?.amount ?? 0) + (transferIn?.amount ?? 0);
    const outflow = (expense?.amount ?? 0) + (transferOut?.amount ?? 0);
    const balance = account.openingBalance + inflow - outflow;

    const isLiability = account.type === "CREDIT_CARD";
    // `+ 0` normalises -0, which `-(0)` produces and which formats as "-0.00" in the UI: a fully
    // paid card would read as owing negative nothing.
    const outstanding = isLiability ? -balance + 0 : null;

    return {
      id: account.id,
      name: account.name,
      type: account.type,
      icon: account.icon,
      color: account.color,
      isActive: account.isActive,
      openingBalance: account.openingBalance,
      balance,
      outstanding,
      creditLimit: account.creditLimit,
      availableCredit:
        isLiability && account.creditLimit != null
          ? account.creditLimit - (outstanding ?? 0)
          : null,
      inflow,
      outflow,
      transactionCount:
        (income?.count ?? 0) +
        (expense?.count ?? 0) +
        (transferOut?.count ?? 0) +
        (transferIn?.count ?? 0),
    };
  });
};
