import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

const batchSchema = z.object({
  transactions: z.array(batchTransactionSchema).min(1).max(MAX_BATCH_TRANSACTIONS),
  clientBatchId: clientBatchIdSchema.optional(),
});

const batchDeleteSchema = z.object({
  ids: z.array(z.string()).min(1),
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

    // Find which IDs actually belong to the user before deleting
    const owned = await prisma.transaction.findMany({
      where: { id: { in: ids }, userId },
      select: { id: true },
    });
    const ownedIds = owned.map((t) => t.id);

    if (ownedIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: { id: { in: ownedIds } },
      });
    }

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
