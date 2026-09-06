import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import {
  batchTransactionSchema,
  clientBatchIdSchema,
  MAX_BATCH_TRANSACTIONS,
} from "@/lib/validations";
import {
  createTransactionBatch,
  findSavedBatch,
  findSavedBatchUnderLock,
} from "@/lib/transaction-writes";
import {
  boundedTransactionIdsSchema,
  bulkTransactionMutationSchema,
} from "@/lib/transaction-bulk";

const batchSchema = z.object({
  transactions: z.array(batchTransactionSchema).min(1).max(MAX_BATCH_TRANSACTIONS),
  clientBatchId: clientBatchIdSchema.optional(),
});

const batchDeleteSchema = z.object({
  ids: boundedTransactionIdsSchema,
});

/**
 * Answer a keyed request that is about to be rejected, re-checking under the advisory lock.
 *
 * The pre-check that runs before validation is an unlocked read, so it cannot see a
 * concurrent attempt that holds the lock and has not committed yet. Rejecting on that basis
 * is unsafe in one direction only: the client reads a 4xx as proof nothing was written, drops
 * its idempotency pin and unfreezes the rows, so a corrected resubmit would create the batch
 * a second time. The window is real: a batch is bounded at 60s, and the retry path exists
 * precisely because a response can be lost while the server is still working.
 *
 * Taking the lock here blocks until any in-flight attempt on this key finishes, turning "no
 * rows yet" into a decision rather than a guess. Only the rejection path pays for it; success
 * keeps the fast unlocked read.
 *
 * If the lock cannot be obtained in time this returns 500, not the original 4xx. A 500 reads
 * as *unknown* to the client, which keeps the rows pinned, the safe direction when we
 * genuinely cannot tell whether the batch exists.
 */
const rejectUnlessAlreadySaved = async (
  userId: string,
  clientBatchId: string | undefined,
  rejection: NextResponse
): Promise<NextResponse> => {
  if (!clientBatchId) return rejection;

  const existing = await findSavedBatchUnderLock(prisma, userId, clientBatchId);
  if (existing === null) {
    return NextResponse.json(
      { error: "Could not confirm whether this batch was already saved" },
      { status: 500 }
    );
  }
  if (existing.length > 0) {
    return NextResponse.json({ transactions: existing }, { status: 200 });
  }
  return rejection;
};

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  // Hoisted so the catch below can tell a rejection apart from a replay.
  let replayKey: string | undefined;

  try {
    const body: unknown = await request.json();

    // A replay creates nothing, so it must not be judged on the validity of inputs it will
    // never use, neither the label ownership query below nor the transaction payload itself.
    // A 4xx tells the client nothing was written, so it drops the idempotency pin and
    // unfreezes the rows; returning one for a batch that *is* committed lets a corrected
    // resubmit duplicate it.
    //
    // That is why this runs before `batchSchema.parse` rather than after. Any tightening of
    // the payload schema would otherwise be able to reject a replay of a batch accepted
    // under the previous schema, the same "judged on inputs it never uses" failure that
    // moved this check ahead of the label query, one layer up.
    //
    // A key that is absent or malformed cannot match an existing batch, so it falls through
    // to normal validation. The authoritative dedupe still happens under the advisory lock
    // further down; this is the same check without the preconditions, not a replacement.
    const providedKey = clientBatchIdSchema.safeParse(
      (body as { clientBatchId?: unknown } | null)?.clientBatchId
    );
    if (providedKey.success) {
      replayKey = providedKey.data;
      const alreadySaved = await findSavedBatch(prisma, userId, providedKey.data);
      if (alreadySaved.length > 0) {
        return NextResponse.json({ transactions: alreadySaved }, { status: 200 });
      }
    }

    const { transactions, clientBatchId } = batchSchema.parse(body);

    const result = await createTransactionBatch({
      prisma,
      userId,
      items: transactions,
      clientBatchId,
      createdVia: "APP",
    });

    if (!result.ok) {
      if (result.reason === "UNKNOWN_WHETHER_SAVED" || result.reason === "NO_LONGER_PERMITTED") {
        return NextResponse.json({ error: "Failed to create transactions" }, { status: 500 });
      }
      const message =
        result.reason === "LABELS_NOT_OWNED"
          ? "One or more labels are invalid or do not belong to you"
          : "One or more categories are invalid or do not belong to you";
      return rejectUnlessAlreadySaved(
        userId,
        clientBatchId,
        NextResponse.json({ error: message }, { status: 400 })
      );
    }

    // 200 rather than 201 on a replay: this request created nothing.
    return NextResponse.json(
      { transactions: result.transactions },
      { status: result.replayed ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return rejectUnlessAlreadySaved(
        userId,
        replayKey,
        NextResponse.json({ error: "Invalid input" }, { status: 400 })
      );
    }
    return NextResponse.json(
      { error: "Failed to create transactions" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const { ids } = batchDeleteSchema.parse(body);

    const ownedIds = await prisma.$transaction(async (tx) => {
      const owned = await tx.transaction.findMany({
        where: { id: { in: ids }, userId },
        select: { id: true },
      });
      const matchedIds = owned.map((transaction) => transaction.id);
      if (matchedIds.length > 0) {
        await tx.transaction.deleteMany({ where: { id: { in: matchedIds }, userId } });
      }
      return matchedIds;
    });

    return NextResponse.json({ deleted: ownedIds.length, ids: ownedIds });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to delete transactions" },
      { status: 500 }
    );
  }
}

/**
 * Stamp the audit columns on rows this route changed.
 *
 * `updated_via` means "which surface last edited this row", and a bulk recategorise or a bulk
 * label change is an edit. Without this, a row edited over MCP and then bulk-changed here would go
 * on naming the MCP token as its last editor -- the same stale, confidently-wrong trail that
 * `PUT /api/transactions/[id]` clears the token id to avoid. Written as its own `updateMany`
 * rather than folded into the category branch's, because the label branches change no column on
 * `transactions` at all and would otherwise stamp nothing.
 */
const stampEdited = (tx: Prisma.TransactionClient, userId: string, ids: string[]) =>
  ids.length === 0
    ? Promise.resolve({ count: 0 })
    : tx.transaction.updateMany({
        where: { id: { in: ids }, userId },
        data: { updatedVia: "APP", updatedByMcpTokenId: null },
      });

export async function PATCH(request: NextRequest) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const input = bulkTransactionMutationSchema.parse(await request.json());

    const result = await prisma.$transaction(async (tx) => {
      const transactions = await tx.transaction.findMany({
        where: { id: { in: input.ids }, userId },
        // `categoryId` so the stamp below can skip rows already in the target category. Selecting
        // it is cheaper than the alternative of recording an edit that did not happen.
        select: { id: true, type: true, categoryId: true },
      });
      const matchedIds = transactions.map((transaction) => transaction.id);
      if (matchedIds.length === 0) {
        return { matched: 0, updated: 0, ids: [] as string[] };
      }

      if (input.action === "category") {
        const category = await tx.category.findFirst({
          where: {
            id: input.categoryId,
            OR: [{ isDefault: true }, { userId }],
          },
          select: { id: true, type: true },
        });
        if (!category) return { error: "Category not found", status: 400 as const };
        if (transactions.some((transaction) => transaction.type !== category.type)) {
          return {
            error: "The category must match every selected transaction's type",
            status: 409 as const,
          };
        }

        // Only the rows whose category actually moves, on the same rule the label branches below
        // follow: a selection of forty where ten are already in the target category must not
        // record an edit on those ten. Stamping them would replace an accurate MCP trail with a
        // fabricated `updated_via: APP` for something that never happened -- the confidently
        // wrong trail this column exists to avoid, written by the code that added it.
        const movingIds = transactions
          .filter((transaction) => transaction.categoryId !== category.id)
          .map((transaction) => transaction.id);

        const updated = await tx.transaction.updateMany({
          where: { id: { in: movingIds }, userId },
          data: { categoryId: category.id, updatedVia: "APP", updatedByMcpTokenId: null },
        });
        return { matched: matchedIds.length, updated: updated.count, ids: matchedIds };
      }

      const labels = await tx.label.findMany({
        where: { id: { in: input.labelIds }, userId },
        select: { id: true, applicableTo: true },
      });
      if (labels.length !== input.labelIds.length) {
        return { error: "One or more labels were not found", status: 400 as const };
      }

      if (
        input.operation === "add" &&
        labels.some((label) =>
          transactions.some(
            (transaction) =>
              label.applicableTo !== "BOTH" && label.applicableTo !== transaction.type,
          ),
        )
      ) {
        return {
          error: "One or more labels do not apply to every selected transaction",
          status: 409 as const,
        };
      }

      const labelIds = labels.map((label) => label.id);
      const existingLinks = await tx.transactionLabel.findMany({
        where: { transactionId: { in: matchedIds }, labelId: { in: labelIds } },
        select: { transactionId: true, labelId: true },
      });

      if (input.operation === "add") {
        const existingKeys = new Set(
          existingLinks.map(({ transactionId, labelId }) => `${transactionId}:${labelId}`),
        );
        const linksToAdd = matchedIds.flatMap((transactionId) =>
          labelIds.flatMap((labelId) =>
            existingKeys.has(`${transactionId}:${labelId}`) ? [] : [{ transactionId, labelId }],
          ),
        );
        const affectedIds = [...new Set(linksToAdd.map(({ transactionId }) => transactionId))];
        const added =
          linksToAdd.length > 0
            ? await tx.transactionLabel.createMany({ data: linksToAdd, skipDuplicates: true })
            : { count: 0 };
        // Only the rows that actually gained a link. Stamping every matched id would record an
        // edit on transactions that already carried the label and did not change.
        await stampEdited(tx, userId, affectedIds);
        return {
          matched: matchedIds.length,
          updated: affectedIds.length,
          changedLinks: added.count,
          ids: affectedIds,
        };
      }

      const affectedIds = [
        ...new Set(existingLinks.map(({ transactionId }) => transactionId)),
      ];
      const removed =
        existingLinks.length > 0
          ? await tx.transactionLabel.deleteMany({
              where: { transactionId: { in: matchedIds }, labelId: { in: labelIds } },
            })
          : { count: 0 };
      await stampEdited(tx, userId, affectedIds);
      return {
        matched: matchedIds.length,
        updated: affectedIds.length,
        changedLinks: removed.count,
        ids: affectedIds,
      };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid bulk action" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update transactions" }, { status: 500 });
  }
}
