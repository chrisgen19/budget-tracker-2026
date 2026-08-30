import type { TransactionType } from "@/lib/budget-query-types";

/**
 * The two transaction types that represent actual spending or earning.
 *
 * `TRANSFER` is money moving between two of the user's own accounts. It is not spending, it is
 * not income, and it must never reach a category total, a cash-flow bucket, or a running balance
 * built from `income - expenses` — counting it there is precisely the double-count that logging a
 * credit-card bill payment used to cause.
 *
 * This exists because TypeScript cannot protect the code that gets this wrong. Nothing switches
 * exhaustively on `TransactionType`; the dangerous shape is a binary ternary —
 * `t.type === "INCOME" ? t.amount : -t.amount` — which compiles perfectly and silently files
 * every transfer as an expense. Adding `TRANSFER` to the enum made six such sites wrong at once.
 * Any new aggregate should either filter `type` explicitly to the one direction it means, or
 * start from `SPENDING_TYPES` / `isSpending`, so the safe behaviour is the one that is easy to
 * reach for.
 */
export const SPENDING_TYPES = ["INCOME", "EXPENSE"] as const;

/** The two directions that are real spending. */
export type SpendingType = (typeof SPENDING_TYPES)[number];

/** Prisma `where` fragment restricting a query to real spending. Spread it into the clause. */
export const SPENDING_ONLY: { type: { in: SpendingType[] } } = {
  // Not `as const`: Prisma's `TransactionWhereInput` wants a mutable array, and a readonly tuple
  // is rejected at every spread site.
  type: { in: ["INCOME", "EXPENSE"] },
};

/** True for a row that belongs in category totals and cash flow; false for a transfer. */
export const isSpending = <T extends { type: string }>(
  // Constrained to `string` rather than `TransactionType` so it also accepts the loosely-typed
  // row shapes the analytics route builds inline; the guard still narrows to the two literals.
  row: T
): row is T & { type: "INCOME" | "EXPENSE" } => row.type !== "TRANSFER";

/**
 * Signed contribution of one row to a net cash-flow figure, or 0 for a transfer.
 *
 * Replaces the `type === "INCOME" ? amount : -amount` ternary at every site that computed a
 * running balance. Written as an explicit three-way test rather than a ternary with a default so
 * that a fourth transaction type, if one is ever added, has to be considered here rather than
 * quietly inheriting whichever branch the `else` happened to be.
 */
export const netDelta = (row: { type: TransactionType; amount: number }): number => {
  if (row.type === "INCOME") return row.amount;
  if (row.type === "EXPENSE") return -row.amount;
  return 0;
};

/**
 * Narrow a stored `type` to the two spending directions, at a boundary where TRANSFER cannot occur.
 *
 * Deliberately *not* the general-purpose escape hatch that `netDelta` exists to replace. It is for
 * entities that structurally cannot be transfers: a recurring bill is validated by
 * `scheduledTransactionSchema`, whose enum is binary, and a user-created category comes from
 * `categorySchema`, which is binary too. Prisma types both as the full three-member enum because
 * they share the column type, so the impossible case has to be discharged somewhere.
 *
 * Use it only where you can name the reason TRANSFER is unreachable. Anywhere a real transaction
 * could arrive, the fallback would silently file a transfer as an expense — the bug this module
 * exists to prevent.
 */
export const asSpendingType = (type: string): SpendingType =>
  type === "INCOME" ? "INCOME" : "EXPENSE";
