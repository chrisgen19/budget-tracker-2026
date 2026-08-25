import { Prisma, type TransactionSource } from "@prisma/client";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";
import type { BatchTransactionInput } from "@/lib/validations";
import type { PrismaClient } from "@/lib/budget-query-types";

/** Bounds for the keyed batch transaction. Prisma defaults to 5s, which a full
 *  MAX_BATCH_TRANSACTIONS batch can exceed: the keyed path awaits each create in turn, so a
 *  200-row save is 200 sequential round trips plus their label associations. Blowing the
 *  deadline rolls the whole batch back and returns a generic 500, which is precisely the
 *  failure large batches were raised to allow. */
export const BATCH_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

/** Shape returned for created and replayed rows alike, so a replay is indistinguishable
 *  from the original response. */
export const TX_INCLUDE = { category: true, labels: { include: { label: true } } } as const;

export type BatchFailureReason =
  /** A label id was not the caller's. */
  | "LABELS_NOT_OWNED"
  /** A category id was neither a default nor the caller's. */
  | "CATEGORIES_NOT_OWNED"
  /** The advisory lock could not be taken, so whether the batch exists is genuinely unknown. */
  | "UNKNOWN_WHETHER_SAVED";

export type CreateBatchResult =
  | { ok: true; transactions: TransactionWithRelations[]; replayed: boolean }
  | { ok: false; reason: BatchFailureReason };

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof TX_INCLUDE;
}>;

export interface CreateTransactionBatchParams {
  /** Injected rather than imported, matching `budget-queries.ts` and `createBudgetMcpServer`,
   *  so the MCP server and the route can each supply their own client. */
  prisma: PrismaClient;
  userId: string;
  items: BatchTransactionInput[];
  /** Makes the write replay-safe. Optional for the app, required by the MCP tool: an agent loop
   *  retries on its own, with no human deciding whether to resubmit. */
  clientBatchId?: string;
  createdVia: TransactionSource;
  /** Recorded when `createdVia` is MCP, so an incident can be traced to one credential. */
  mcpTokenId?: string;
}

/** Look for an already-committed batch under this key, without taking the lock. */
export const findSavedBatch = (
  prisma: PrismaClient,
  userId: string,
  clientBatchId: string
): Promise<TransactionWithRelations[]> =>
  prisma.transaction.findMany({ where: { userId, clientBatchId }, include: TX_INCLUDE });

/**
 * Look for an already-committed batch under this key, *under the advisory lock*.
 *
 * The unlocked read cannot see a concurrent attempt that holds the lock and has not committed
 * yet. Taking the lock blocks until any in-flight attempt on this key finishes, turning "no rows
 * yet" into a decision rather than a guess.
 *
 * Returns `null` when the lock could not be taken in time, which callers must render as *unknown*
 * rather than as a rejection: a 4xx tells the client nothing was written, so it drops its
 * idempotency pin and a corrected resubmit would create the batch a second time.
 */
export const findSavedBatchUnderLock = async (
  prisma: PrismaClient,
  userId: string,
  clientBatchId: string
): Promise<TransactionWithRelations[] | null> => {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientBatchId}))`;
      return tx.transaction.findMany({ where: { userId, clientBatchId }, include: TX_INCLUDE });
    }, BATCH_TX_OPTIONS);
  } catch {
    return null;
  }
};

/**
 * Verify every referenced category is usable by this caller.
 *
 * Categories are either defaults (`userId: null`, shared by everyone) or owned by one user, and
 * neither create path used to check this — only labels were checked. That was latent while the
 * sole caller was the user's own browser session. It stops being latent once a model supplies
 * `categoryId` over an internet-facing endpoint, since the foreign key alone is satisfied by any
 * category that exists, including another user's.
 */
const categoriesAreUsable = async (
  prisma: PrismaClient,
  userId: string,
  categoryIds: string[]
): Promise<boolean> => {
  if (categoryIds.length === 0) return true;
  const usable = await prisma.category.findMany({
    where: { id: { in: categoryIds }, OR: [{ userId }, { userId: null }] },
    select: { id: true },
  });
  return usable.length === categoryIds.length;
};

/**
 * Create many transactions in one atomic write, optionally idempotent under `clientBatchId`.
 *
 * Extracted from `POST /api/transactions/batch` so the MCP tool and the route share one
 * implementation. A second copy would drift the moment label resolution or the idempotency
 * contract changed, and nothing would catch it.
 */
export const createTransactionBatch = async ({
  prisma,
  userId,
  items,
  clientBatchId,
  createdVia,
  mcpTokenId,
}: CreateTransactionBatchParams): Promise<CreateBatchResult> => {
  // Collect all explicitly-provided label IDs for a single ownership query
  const allExplicitLabelIds = [...new Set(items.flatMap((t) => t.labelIds ?? []))];

  let ownedLabelMap = new Map<string, string>();
  if (allExplicitLabelIds.length > 0) {
    const ownedLabels = await prisma.label.findMany({
      where: { id: { in: allExplicitLabelIds }, userId },
      select: { id: true, applicableTo: true },
    });
    if (ownedLabels.length !== allExplicitLabelIds.length) {
      return { ok: false, reason: "LABELS_NOT_OWNED" };
    }
    ownedLabelMap = new Map(ownedLabels.map((l) => [l.id, l.applicableTo]));
  }

  const categoryIds = [...new Set(items.map((t) => t.categoryId))];
  if (!(await categoriesAreUsable(prisma, userId, categoryIds))) {
    return { ok: false, reason: "CATEGORIES_NOT_OWNED" };
  }

  // Fetch schedule context only when at least one item needs auto-tagging
  const needsAutoLabel = items.some((t) => t.labelIds === undefined);
  const ctx = needsAutoLabel ? await getScheduleContext(userId) : null;

  const buildCreates = (tx: Prisma.TransactionClient) =>
    items.map((t) => {
      const txDate = new Date(t.date);

      // Resolve labels per item:
      // - labelIds === undefined → auto-apply from schedules
      // - labelIds === [] → user opted out, no labels
      // - labelIds === ['id1', ...] → use explicit labels (type-filtered)
      let resolvedLabelIds: string[] = [];
      if (t.labelIds === undefined) {
        const scheduledLabelId = ctx ? matchScheduledLabel(txDate, ctx, t.type) : null;
        if (scheduledLabelId) resolvedLabelIds = [scheduledLabelId];
      } else if (t.labelIds.length > 0) {
        const seen = new Set<string>();
        resolvedLabelIds = t.labelIds.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          const applicableTo = ownedLabelMap.get(id);
          return applicableTo === "BOTH" || applicableTo === t.type;
        });
      }

      return tx.transaction.create({
        data: {
          amount: t.amount,
          description: t.description,
          type: t.type,
          date: txDate,
          categoryId: t.categoryId,
          userId,
          createdVia,
          ...(mcpTokenId && { mcpTokenId }),
          ...(clientBatchId && { clientBatchId }),
          ...(t.receiptGroupId && { receiptGroupId: t.receiptGroupId }),
          ...(t.receiptBreakdown && { receiptBreakdown: t.receiptBreakdown }),
          ...(resolvedLabelIds.length > 0 && {
            labels: { createMany: { data: resolvedLabelIds.map((labelId) => ({ labelId })) } },
          }),
        },
        include: TX_INCLUDE,
      });
    });

  // Without a key this stays exactly as it was: one atomic multi-create.
  if (!clientBatchId) {
    const created = await prisma.$transaction(buildCreates(prisma as Prisma.TransactionClient));
    return { ok: true, transactions: created, replayed: false };
  }

  // With a key the write is replay-safe. A batch that commits but whose response is lost is
  // indistinguishable from one that never ran, and both the review modal and an agent retry
  // would post the same rows again. The advisory lock serialises attempts on the key so the
  // existence check cannot be raced by a double submit (see also src/lib/scan-quota.ts).
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientBatchId}))`;

      const existing = await tx.transaction.findMany({
        where: { userId, clientBatchId },
        include: TX_INCLUDE,
      });
      if (existing.length > 0) {
        return { ok: true as const, transactions: existing, replayed: true };
      }

      const rows: TransactionWithRelations[] = [];
      for (const create of buildCreates(tx)) rows.push(await create);
      return { ok: true as const, transactions: rows, replayed: false };
    }, BATCH_TX_OPTIONS);
  } catch {
    // The write itself failed under the lock, so whether anything committed is unknown.
    return { ok: false, reason: "UNKNOWN_WHETHER_SAVED" };
  }
};
