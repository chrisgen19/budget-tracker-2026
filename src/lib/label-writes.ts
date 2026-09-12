import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";

/**
 * The single create path for labels, shared by `POST /api/labels` and the MCP `create_label` tool.
 *
 * Small, but worth sharing for one property that is easy to lose: the name check is
 * case-insensitive and there is no unique index behind it, so a second copy that compared names
 * exactly would let "Work" and "work" both exist -- and the Telegram label resolver, which matches
 * case-insensitively and reports two candidates as ambiguous, would then refuse every mention of
 * either. `P2002` is still treated as a duplicate so a concurrent create loses cleanly if an index
 * is added later.
 */

export const LABEL_INCLUDE = {
  _count: { select: { transactions: true } },
  schedules: { orderBy: { createdAt: "asc" } },
  categories: { select: { categoryId: true } },
} as const;

export type LabelWithRelations = Prisma.LabelGetPayload<{ include: typeof LABEL_INCLUDE }>;

export type LabelWriteFailureReason =
  /** A label with this name already exists on the account, ignoring case. */
  | "DUPLICATE_NAME"
  /** One or more `categoryIds` are not usable -- unknown, someone else's, or the wrong type. */
  | "INVALID_CATEGORIES"
  /** The write lease lapsed between the request arriving and the write. Nothing was written. */
  | "NO_LONGER_PERMITTED";

export type LabelWriteResult =
  | { ok: true; label: LabelWithRelations }
  | { ok: false; reason: "INVALID_CATEGORIES"; message: string }
  | { ok: false; reason: Exclude<LabelWriteFailureReason, "INVALID_CATEGORIES"> };

/**
 * Check that every category a label is being restricted to is one this user may use, and that its
 * type agrees with the label's own `applicableTo`.
 *
 * Shared by `createLabel` and `PUT /api/labels/[id]` so the two cannot disagree. The type check is
 * the half that is easy to leave out and would be quietly destructive: restricting an
 * income-only label to an expense category produces a label that can never match anything, which
 * looks identical to a label that simply stopped appearing.
 *
 * Defaults (`userId: null`) are shared by every account and are usable by all of them, which is
 * why ownership is `isDefault OR mine` rather than `userId = mine` -- the same condition
 * `GET /api/categories` uses.
 */
export const categoriesUsableForLabel = async (
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  categoryIds: string[],
  applicableTo: "EXPENSE" | "INCOME" | "BOTH",
): Promise<{ ok: true } | { ok: false; message: string }> => {
  if (categoryIds.length === 0) return { ok: true };

  const found = await prisma.category.findMany({
    where: { id: { in: categoryIds }, OR: [{ isDefault: true }, { userId }] },
    select: { id: true, name: true, type: true },
  });

  if (found.length !== categoryIds.length) {
    return { ok: false, message: "One or more categories could not be found." };
  }

  if (applicableTo !== "BOTH") {
    const wrongType = found.filter((c) => c.type !== applicableTo);
    if (wrongType.length > 0) {
      const names = wrongType.map((c) => c.name).join(", ");
      const noun = applicableTo === "EXPENSE" ? "expenses" : "income";
      return {
        ok: false,
        message: `This label only applies to ${noun}, so it cannot be limited to ${names}.`,
      };
    }
  }

  return { ok: true };
};

export interface LabelScheduleInput {
  /** 0 = Sunday. */
  days: number[];
  /** Zero-padded HH:mm. Compared as a string everywhere, so "8:00" sorts after "20:00". */
  startTime: string;
  endTime: string;
}

export interface CreateLabelParams {
  prisma: PrismaClient;
  userId: string;
  name: string;
  color: string;
  applicableTo: "EXPENSE" | "INCOME" | "BOTH";
  schedules?: LabelScheduleInput[];
  /** Categories to restrict the label to. **Empty or absent means every category**, not none. */
  categoryIds?: string[];
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

export const createLabel = async ({
  prisma,
  userId,
  name,
  color,
  applicableTo,
  schedules,
  categoryIds,
  assertStillPermitted,
}: CreateLabelParams): Promise<LabelWriteResult> => {
  const existing = await prisma.label.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, userId },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "DUPLICATE_NAME" };

  const categoryCheck = await categoriesUsableForLabel(
    prisma,
    userId,
    categoryIds ?? [],
    applicableTo,
  );
  if (!categoryCheck.ok) {
    return { ok: false, reason: "INVALID_CATEGORIES", message: categoryCheck.message };
  }

  try {
    const label = await prisma.$transaction(async (tx) => {
      if (assertStillPermitted && !(await assertStillPermitted(tx))) return null;

      return tx.label.create({
        data: {
          name,
          color,
          applicableTo,
          userId,
          ...(schedules && schedules.length > 0 && {
            schedules: {
              create: schedules.map((s) => ({
                days: s.days,
                startTime: s.startTime,
                endTime: s.endTime,
              })),
            },
          }),
          ...(categoryIds && categoryIds.length > 0 && {
            categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
          }),
        },
        include: LABEL_INCLUDE,
      });
    });

    if (label === null) return { ok: false, reason: "NO_LONGER_PERMITTED" };
    return { ok: true, label };
  } catch (error) {
    // A concurrent create that won the race produced exactly the row this one wanted, so the
    // caller is told the same thing the pre-check would have told it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "DUPLICATE_NAME" };
    }
    throw error;
  }
};

/**
 * The physical names behind `TransactionLabel`. The raw delete below cannot go through Prisma's
 * field mapping, so this is the one place the `@map` / `@@map` names are restated in application
 * code -- and `label-writes.schema.test.ts` asserts they still match `prisma/schema.prisma`, since
 * a rename would otherwise surface at runtime rather than at `pnpm type-check`.
 */
export const TRANSACTION_LABELS_TABLE = "transaction_labels";
export const TRANSACTION_LABELS_COLUMNS = {
  transactionId: "transaction_id",
  labelId: "label_id",
} as const;

export interface LabelLinkRemoval {
  /** Distinct transactions that really lost at least one link. These are safe to stamp. */
  transactionIds: string[];
  /** Link rows really deleted, for the `changedLinks` / `removed` counters. */
  linkCount: number;
}

/**
 * Remove transaction-label links and report the transactions that *actually* lost one.
 *
 * The single removal path, shared by the bulk `PATCH /api/transactions/batch` label branch and the
 * retroactive `POST /api/labels/[id]/apply` removal branch (#251).
 *
 * Both callers used to plan the removal from a snapshot read before the write and then stamp
 * `updated_via: APP` on every row in that plan. `deleteMany` returns `{ count }` and no row
 * identity, so a concurrent MCP edit that removed the same link first made the delete a partial
 * no-op while the row was stamped anyway -- overwriting an accurate MCP trail with an `APP` edit
 * that never happened, and over-reporting `updated` / `ids` by the same amount. That is the same
 * class of bug the sibling *insert* branches closed in #247 with `createManyAndReturn`; there is
 * no `deleteManyAndReturn` in Prisma 6.19.2, so this drops to SQL for the one thing Prisma cannot
 * express. `RETURNING` names the rows the delete really removed, re-evaluated by Postgres against
 * the committed row versions, so a link somebody else deleted first is simply absent from it.
 *
 * Re-reading the links inside the transaction just before the delete was deliberately **not** the
 * fix: it narrows the window to microseconds without closing it under READ COMMITTED, which reads
 * as fixed and is not.
 *
 * Matched by `(transaction_id, label_id)` rather than by link-row id, which is what lets one
 * helper serve both callers -- and it is the identity they actually mean, since
 * `@@unique([transactionId, labelId])` allows at most one row per pair. Scoped to `userId` through
 * `transactions` as well, so a caller passing ids it has not already narrowed still deletes
 * nothing belonging to anyone else.
 */
export const removeTransactionLabels = async (
  tx: Prisma.TransactionClient,
  userId: string,
  transactionIds: string[],
  labelIds: string[],
): Promise<LabelLinkRemoval> => {
  // An empty `ANY(ARRAY[])` is legal SQL but a guaranteed no-op, so skip the round trip.
  if (transactionIds.length === 0 || labelIds.length === 0) {
    return { transactionIds: [], linkCount: 0 };
  }

  // `id` is `String @default(cuid())`, so these columns are `text` and the arrays bind as `text[]`
  // with no cast. (The `timestamptz` trap `consumeRateLimit` documents is specific to `Date`
  // parameters and does not apply here.)
  const rows = await tx.$queryRaw<{ transaction_id: string }[]>`
    DELETE FROM transaction_labels tl
    USING transactions t
    WHERE tl.transaction_id = t.id
      AND t.user_id = ${userId}
      AND tl.transaction_id = ANY(${transactionIds})
      AND tl.label_id = ANY(${labelIds})
    RETURNING tl.transaction_id
  `;

  return {
    // Deduped: one transaction losing two labels is one edited row, and the response's `ids`
    // would otherwise name it twice.
    transactionIds: [...new Set(rows.map((row) => row.transaction_id))],
    linkCount: rows.length,
  };
};
