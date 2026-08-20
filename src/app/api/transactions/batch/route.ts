import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import {
  batchTransactionSchema,
  clientBatchIdSchema,
  MAX_BATCH_TRANSACTIONS,
} from "@/lib/validations";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";

const batchSchema = z.object({
  transactions: z.array(batchTransactionSchema).min(1).max(MAX_BATCH_TRANSACTIONS),
  clientBatchId: clientBatchIdSchema.optional(),
});

/** Bounds for the keyed batch transaction. Prisma defaults to 5s, which a full
 *  MAX_BATCH_TRANSACTIONS batch can exceed: the keyed path awaits each create in turn, so a
 *  200-row save is 200 sequential round trips plus their label associations. Blowing the
 *  deadline rolls the whole batch back and returns a generic 500, which is precisely the
 *  failure large batches were raised to allow. */
const BATCH_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

/** Shape returned for created and replayed rows alike, so a replay is indistinguishable
 *  from the original response. */
const TX_INCLUDE = { category: true, labels: { include: { label: true } } } as const;

const batchDeleteSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const { transactions, clientBatchId } = batchSchema.parse(body);

    // A replay creates nothing, so it must not be judged on the validity of inputs it will
    // never use. Checked ahead of the label ownership query below: if a label included in
    // the original batch is deleted before the retry arrives, validating first returns 400
    // for a batch that is already committed — and a 400 tells the client nothing was
    // written, which would unfreeze the rows and let a corrected resubmit duplicate them.
    // The authoritative dedupe still happens under the advisory lock further down; this is
    // the same check without the preconditions, not a replacement for it.
    if (clientBatchId) {
      const alreadySaved = await prisma.transaction.findMany({
        where: { userId, clientBatchId },
        include: TX_INCLUDE,
      });
      if (alreadySaved.length > 0) {
        return NextResponse.json({ transactions: alreadySaved }, { status: 200 });
      }
    }

    // Collect all explicitly-provided label IDs for a single ownership query
    const allExplicitLabelIds = [
      ...new Set(transactions.flatMap((t) => t.labelIds ?? [])),
    ];

    // Validate ownership + fetch applicableTo in one query
    let ownedLabelMap = new Map<string, string>();
    if (allExplicitLabelIds.length > 0) {
      const ownedLabels = await prisma.label.findMany({
        where: { id: { in: allExplicitLabelIds }, userId },
        select: { id: true, applicableTo: true },
      });
      if (ownedLabels.length !== allExplicitLabelIds.length) {
        return NextResponse.json(
          { error: "One or more labels are invalid or do not belong to you" },
          { status: 400 }
        );
      }
      ownedLabelMap = new Map(ownedLabels.map((l) => [l.id, l.applicableTo]));
    }

    // Fetch schedule context only when at least one item needs auto-tagging
    const needsAutoLabel = transactions.some((t) => t.labelIds === undefined);
    const ctx = needsAutoLabel ? await getScheduleContext(userId) : null;

    const buildCreates = (tx: Prisma.TransactionClient) =>
      transactions.map((t) => {
        const txDate = new Date(t.date);

        // Resolve labels per item:
        // - labelIds === undefined → auto-apply from schedules
        // - labelIds === [] → user opted out, no labels
        // - labelIds === ['id1', ...] → use explicit labels (type-filtered)
        let resolvedLabelIds: string[] = [];
        if (t.labelIds === undefined) {
          const scheduledLabelId = ctx
            ? matchScheduledLabel(txDate, ctx, t.type)
            : null;
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
            ...(clientBatchId && { clientBatchId }),
            ...(t.receiptGroupId && { receiptGroupId: t.receiptGroupId }),
            ...(t.receiptBreakdown && { receiptBreakdown: t.receiptBreakdown }),
            ...(resolvedLabelIds.length > 0 && {
              labels: {
                createMany: {
                  data: resolvedLabelIds.map((labelId) => ({ labelId })),
                },
              },
            }),
          },
          include: TX_INCLUDE,
        });
      });

    // Without a key this stays exactly as it was: one atomic multi-create.
    if (!clientBatchId) {
      const created = await prisma.$transaction(buildCreates(prisma));
      return NextResponse.json({ transactions: created }, { status: 201 });
    }

    // With a key the write is replay-safe. A batch that commits but whose response is lost
    // is indistinguishable from one that never ran, and the review modal invites a retry,
    // which would post the same receipts again. The advisory lock serialises attempts on
    // the key so the existence check cannot be raced by a double submit — the same reason
    // the scan quota needs one (see src/lib/scan-quota.ts).
    const { transactions: created, replayed } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientBatchId}))`;

      const existing = await tx.transaction.findMany({
        where: { userId, clientBatchId },
        include: TX_INCLUDE,
      });
      if (existing.length > 0) return { transactions: existing, replayed: true };

      const rows = [];
      for (const create of buildCreates(tx)) rows.push(await create);
      return { transactions: rows, replayed: false };
    }, BATCH_TX_OPTIONS);

    // 200 rather than 201 on a replay: this request created nothing.
    return NextResponse.json({ transactions: created }, { status: replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
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
