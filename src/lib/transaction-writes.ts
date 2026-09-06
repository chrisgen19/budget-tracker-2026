import { Prisma, type TransactionSource, type TransactionType } from "@prisma/client";
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
  /** A category id was neither a default nor the caller's, or its type did not match the item's. */
  | "CATEGORIES_NOT_OWNED"
  /** Permission was withdrawn between the request arriving and the write starting. */
  | "NO_LONGER_PERMITTED"
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
  /** Recorded for any token-carried source, so an incident can be traced to one credential. */
  mcpTokenId?: string;
  /**
   * Re-checked inside the write transaction, immediately before any row is created. Returning
   * false aborts without writing.
   *
   * The MCP path reads its write lease once, when the request arrives. A batch can then sit in a
   * database transaction for up to a minute, so a user who hits the kill switch during one would
   * watch it commit anyway, and a client that pipelined several requests would have them all
   * commit after the switch. Re-reading at the moment of the write closes that window, which is
   * the difference between a kill switch and a request-admission check.
   */
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
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
 * Verify every item's category is usable by this caller *and* matches the item's type.
 *
 * Two checks the create paths never made. Categories are either defaults (`userId: null`, shared
 * by everyone) or owned by one user, and only labels used to be checked, so the foreign key alone
 * accepted any category that exists, including another user's. Separately, an EXPENSE filed under
 * an INCOME category is internally inconsistent and would distort every breakdown that groups by
 * category; the app's form never allows it because it filters the picker by type, but nothing
 * enforced it server-side.
 *
 * Both were latent while the sole caller was the user's own browser session. Neither is latent
 * once a model supplies `categoryId` over an internet-facing endpoint.
 *
 * Typed on the two fields it reads rather than on `BatchTransactionInput`, so the update path can
 * hand it merged patch-over-row pairs. Those carry no `amount` or `date` of their own -- an edit
 * that changes only the category has neither -- and widening here beat inventing them at the call
 * site to satisfy a signature that never looks at them.
 */
const categoriesAreUsable = async (
  prisma: PrismaClient,
  userId: string,
  items: readonly { categoryId: string; type: TransactionType }[]
): Promise<boolean> => {
  const categoryIds = [...new Set(items.map((t) => t.categoryId))];
  if (categoryIds.length === 0) return true;

  const usable = await prisma.category.findMany({
    where: { id: { in: categoryIds }, OR: [{ userId }, { userId: null }] },
    select: { id: true, type: true },
  });
  if (usable.length !== categoryIds.length) return false;

  const typeById = new Map(usable.map((c) => [c.id, c.type]));
  return items.every((t) => typeById.get(t.categoryId) === t.type);
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
  assertStillPermitted,
}: CreateTransactionBatchParams): Promise<CreateBatchResult> => {
  // A replay creates nothing, so it must not be judged on references it will never use. Labels
  // and categories are mutable: if the original write committed but its response was lost, and a
  // label was deleted before the retry, validating first would reject a batch that is already
  // saved. The caller reads that as "nothing was written", and a corrected resubmit under a fresh
  // key duplicates it. The HTTP route has always guarded this with `rejectUnlessAlreadySaved`;
  // the guard lives here now so the MCP tool, which calls this directly, is covered too.
  if (clientBatchId) {
    const alreadySaved = await findSavedBatch(prisma, userId, clientBatchId);
    if (alreadySaved.length > 0) {
      return { ok: true, transactions: alreadySaved, replayed: true };
    }
  }

  /** Re-check under the lock before rejecting, so a concurrent in-flight attempt is not mistaken
   *  for "never written". A lock we cannot take means genuinely unknown, never a rejection. */
  const rejectUnlessSaved = async (reason: BatchFailureReason): Promise<CreateBatchResult> => {
    if (!clientBatchId) return { ok: false, reason };
    const existing = await findSavedBatchUnderLock(prisma, userId, clientBatchId);
    if (existing === null) return { ok: false, reason: "UNKNOWN_WHETHER_SAVED" };
    if (existing.length > 0) return { ok: true, transactions: existing, replayed: true };
    return { ok: false, reason };
  };

  // Collect all explicitly-provided label IDs for a single ownership query
  const allExplicitLabelIds = [...new Set(items.flatMap((t) => t.labelIds ?? []))];

  let ownedLabelMap = new Map<string, string>();
  if (allExplicitLabelIds.length > 0) {
    const ownedLabels = await prisma.label.findMany({
      where: { id: { in: allExplicitLabelIds }, userId },
      select: { id: true, applicableTo: true },
    });
    if (ownedLabels.length !== allExplicitLabelIds.length) {
      return rejectUnlessSaved("LABELS_NOT_OWNED");
    }
    ownedLabelMap = new Map(ownedLabels.map((l) => [l.id, l.applicableTo]));
  }

  if (!(await categoriesAreUsable(prisma, userId, items))) {
    return rejectUnlessSaved("CATEGORIES_NOT_OWNED");
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
    if (assertStillPermitted && !(await assertStillPermitted(prisma as Prisma.TransactionClient))) {
      return { ok: false, reason: "NO_LONGER_PERMITTED" };
    }
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

      // Checked here, under the lock and inside the transaction, so the answer cannot go stale
      // between the decision and the write. A replay is already handled above and writes
      // nothing, so it is deliberately not gated on this.
      if (assertStillPermitted && !(await assertStillPermitted(tx))) {
        return { ok: false as const, reason: "NO_LONGER_PERMITTED" as const };
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

// --- Updating existing transactions ---

/** Fields an edit may change: exactly the six the app's own edit modal exposes.
 *
 *  `createdVia`, `mcpTokenId`, `clientBatchId`, `billId`, `receiptGroupId` and `receiptBreakdown`
 *  are deliberately absent. The first two describe how the row came to exist and overwriting them
 *  would falsify provenance; re-pointing `billId` would silently settle a different bill's
 *  occurrence. None of them is a correction anyone makes by hand. */
export const UPDATABLE_FIELDS = [
  "amount",
  "description",
  "type",
  "date",
  "categoryId",
  "labelIds",
] as const;

export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export interface TransactionPatch {
  id: string;
  amount?: number;
  description?: string;
  type?: TransactionType;
  /** An account-local date or datetime string, resolved by the caller the same way creates are. */
  date?: string;
  categoryId?: string;
  /** Explicit ids replace the row's labels. Omitted preserves what it already carries. */
  labelIds?: string[];
}

export type UpdateFailureReason =
  /** An id was not this user's, or does not exist. The two are not distinguished on purpose. */
  | "NOT_FOUND"
  /** A patch named no field to change. */
  | "NO_FIELDS"
  /** The same id appeared twice in one batch, so the outcome would depend on ordering. */
  | "DUPLICATE_ID"
  | "LABELS_NOT_OWNED"
  | "CATEGORIES_NOT_OWNED"
  /** Permission was withdrawn between the request arriving and the write starting. */
  | "NO_LONGER_PERMITTED"
  /** The write itself failed and rolled back. Every row is exactly as it was. */
  | "WRITE_FAILED";

/** One row's result: what it is now, and what actually moved. */
export interface UpdatedTransaction {
  transaction: TransactionWithRelations;
  /** Only the fields whose stored value genuinely differs from what was there before. */
  changed: UpdatableField[];
  /** The previous values of exactly those fields, so a caller can show the edit rather than
   *  assert it. Labels are names, matching how they are rendered everywhere else. */
  previous: Partial<{
    amount: number;
    description: string;
    type: TransactionType;
    date: Date;
    categoryName: string;
    labels: string[];
  }>;
}

export type UpdateTransactionsResult =
  | { ok: true; updated: UpdatedTransaction[] }
  | { ok: false; reason: UpdateFailureReason };

export interface UpdateTransactionsParams {
  prisma: PrismaClient;
  userId: string;
  patches: TransactionPatch[];
  /** Stamped onto `updated_via`. Set by the caller from its own surface, never from input. */
  updatedVia: TransactionSource;
  /**
   * Stamped onto `updated_by_mcp_token_id`. Pass `null` explicitly from the app, so a row edited
   * over MCP and then corrected in the browser stops naming the token as its last editor.
   */
  updatedByMcpTokenId: string | null;
  /** Re-checked inside the write transaction, for the same reason and in the same shape as on
   *  the create path: a kill switch has to stop work already in flight, not only the next call. */
  assertStillPermitted?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

/** Labels to keep when the caller sent none: everything already there that still fits the type.
 *
 *  Scheduled labels are deliberately *not* re-matched on an edit. A schedule's premise is a real
 *  clock at the moment of spending, so re-running it here would let correcting a typo in a
 *  description silently re-tag the row, overwriting a choice the user made by hand. */
const preservedLabelIds = (
  current: TransactionWithRelations["labels"],
  effectiveType: TransactionType
): string[] =>
  current
    .filter((l) => l.label.applicableTo === "BOTH" || l.label.applicableTo === effectiveType)
    .map((l) => l.labelId);

/**
 * Apply partial edits to existing transactions, atomically.
 *
 * The single update path, shared by `PUT /api/transactions/[id]` and the MCP `update_transactions`
 * tool, for the same reason `createTransactionBatch` is shared: a second copy would drift the
 * moment the label rules or the category checks changed, and nothing would catch it. The route
 * gained the category ownership and type-match checks by moving here -- it had never had them,
 * which was latent while the only caller was the user's own browser and is not latent once a
 * model supplies `categoryId` over an internet-facing endpoint.
 *
 * All-or-nothing across the batch. Unlike a create there is no idempotency key to replay with, so
 * a half-applied batch would leave the caller unable to say which rows moved and unable to safely
 * resubmit.
 */
export const updateTransactions = async ({
  prisma,
  userId,
  patches,
  updatedVia,
  updatedByMcpTokenId,
  assertStillPermitted,
}: UpdateTransactionsParams): Promise<UpdateTransactionsResult> => {
  const ids = patches.map((p) => p.id);
  // Two patches for one row would apply in array order and the loser would vanish silently, which
  // is a worse answer than refusing: the caller believes both edits landed.
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "DUPLICATE_ID" };

  // A patch naming nothing still stamps the audit columns and moves `updated_at`, so it is not a
  // free no-op and is refused rather than quietly accepted.
  if (patches.some((p) => !UPDATABLE_FIELDS.some((f) => p[f] !== undefined))) {
    return { ok: false, reason: "NO_FIELDS" };
  }

  // Scoped to `userId`, so another user's id is simply not found. Deliberately indistinguishable
  // from a nonexistent one: telling them apart would let a token probe for ids it does not own.
  const rows = await prisma.transaction.findMany({
    where: { id: { in: ids }, userId },
    include: TX_INCLUDE,
  });
  if (rows.length !== ids.length) return { ok: false, reason: "NOT_FOUND" };
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // Every check below runs against the row as it *will be*, never against the patch alone. The
  // case that makes the difference is a patch that flips `type` and sends no `categoryId`: the
  // stored category is untouched by the patch and is exactly what has to be re-examined, or an
  // EXPENSE turned INCOME keeps a food category and distorts every breakdown that groups by one.
  const effective = patches.map((patch) => {
    const row = rowById.get(patch.id)!;
    return {
      patch,
      row,
      type: patch.type ?? row.type,
      categoryId: patch.categoryId ?? row.categoryId,
    };
  });

  if (!(await categoriesAreUsable(prisma, userId, effective))) {
    return { ok: false, reason: "CATEGORIES_NOT_OWNED" };
  }

  // One ownership query for every explicitly named label across the batch, as on the create path.
  const explicitLabelIds = [...new Set(patches.flatMap((p) => p.labelIds ?? []))];
  let ownedLabelMap = new Map<string, string>();
  if (explicitLabelIds.length > 0) {
    const owned = await prisma.label.findMany({
      where: { id: { in: explicitLabelIds }, userId },
      select: { id: true, applicableTo: true },
    });
    if (owned.length !== explicitLabelIds.length) return { ok: false, reason: "LABELS_NOT_OWNED" };
    ownedLabelMap = new Map(owned.map((l) => [l.id, l.applicableTo]));
  }

  const resolved = effective.map((e) => {
    // The same three-way rule as the create path, minus its schedule branch: explicit ids are
    // deduped and type-filtered, `[]` clears them, and omitting the field preserves what is there.
    const labelIds =
      e.patch.labelIds === undefined
        ? preservedLabelIds(e.row.labels, e.type)
        : [...new Set(e.patch.labelIds)].filter((id) => {
            const applicableTo = ownedLabelMap.get(id);
            return applicableTo === "BOTH" || applicableTo === e.type;
          });

    return { ...e, labelIds };
  });

  try {
    return await prisma.$transaction(async (tx) => {
      if (assertStillPermitted && !(await assertStillPermitted(tx))) {
        return { ok: false as const, reason: "NO_LONGER_PERMITTED" as const };
      }

      const updated: UpdatedTransaction[] = [];

      for (const { patch, row, type, categoryId, labelIds } of resolved) {
        const labelsBefore = row.labels.map((l) => l.label.name).sort();
        const labelIdsBefore = row.labels.map((l) => l.labelId).sort();
        const labelsMoved = [...labelIds].sort().join(" ") !== labelIdsBefore.join(" ");

        await tx.transaction.update({
          where: { id: patch.id },
          data: {
            ...(patch.amount !== undefined && { amount: patch.amount }),
            ...(patch.description !== undefined && { description: patch.description }),
            ...(patch.type !== undefined && { type }),
            ...(patch.date !== undefined && { date: new Date(patch.date) }),
            ...(patch.categoryId !== undefined && { categoryId }),
            updatedVia,
            updatedByMcpTokenId,
          },
        });

        // Replaced wholesale rather than diffed. `transaction_labels` holds nothing but the
        // pairing, so there is no per-row state a diff would preserve, and delete-then-create is
        // the shape the app's route has always used.
        if (labelsMoved) {
          await tx.transactionLabel.deleteMany({ where: { transactionId: patch.id } });
          if (labelIds.length > 0) {
            await tx.transactionLabel.createMany({
              data: labelIds.map((labelId) => ({ transactionId: patch.id, labelId })),
            });
          }
        }

        const after = await tx.transaction.findUniqueOrThrow({
          where: { id: patch.id },
          include: TX_INCLUDE,
        });

        // Reported by comparing stored values, not by which keys the patch carried. Sending an
        // amount identical to the one already there changed nothing, and listing it anyway would
        // have the caller tell the user about an edit that did not happen.
        const changed: UpdatableField[] = [];
        const previous: UpdatedTransaction["previous"] = {};
        if (after.amount !== row.amount) {
          changed.push("amount");
          previous.amount = row.amount;
        }
        if (after.description !== row.description) {
          changed.push("description");
          previous.description = row.description;
        }
        if (after.type !== row.type) {
          changed.push("type");
          previous.type = row.type;
        }
        if (after.date.getTime() !== row.date.getTime()) {
          changed.push("date");
          previous.date = row.date;
        }
        if (after.categoryId !== row.categoryId) {
          changed.push("categoryId");
          previous.categoryName = row.category.name;
        }
        if (labelsMoved) {
          changed.push("labelIds");
          previous.labels = labelsBefore;
        }

        updated.push({ transaction: after, changed, previous });
      }

      return { ok: true as const, updated };
    }, BATCH_TX_OPTIONS);
  } catch {
    // The whole batch is one transaction, so a throw rolled all of it back. Unlike the create
    // path there is no ambiguity to report: there are no new rows to hunt for, and every row is
    // exactly as it was, so the caller can simply try again.
    return { ok: false, reason: "WRITE_FAILED" };
  }
};
