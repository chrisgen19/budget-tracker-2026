import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";
import { removeTransactionLabels } from "@/lib/label-writes";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  // Verify label ownership and has schedules
  const label = await prisma.label.findFirst({
    where: { id, userId },
    include: { schedules: true, categories: { select: { categoryId: true } } },
  });

  if (!label) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  if (label.schedules.length === 0) {
    return NextResponse.json(
      { error: "This label has no schedules" },
      { status: 400 }
    );
  }

  // Fetch schedule context (all labels with schedules + timezone) for overlap priority
  const ctx = await getScheduleContext(userId);
  if (!ctx) {
    return NextResponse.json({ applied: 0 });
  }

  // Process transactions in batches using cursor-based pagination.
  // For each transaction: insert the label if the schedule matches, or remove
  // a stale association if the schedule no longer matches (e.g. after edit).
  let applied = 0;
  let removed = 0;
  let cursor: string | undefined;
  const BATCH_SIZE = 500;

  while (true) {
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        // Only process transactions matching the label's type restriction
        ...(label.applicableTo !== "BOTH" && { type: label.applicableTo as "INCOME" | "EXPENSE" }),
      },
      select: {
        id: true,
        date: true,
        type: true,
        // Needed by `matchScheduledLabel`, which will not auto-apply a label into a category its
        // restriction excludes. Deliberately *not* narrowed in the `where` above the way the type
        // restriction is: a row outside the categories may still be carrying this label from
        // before the restriction was added, and the removal branch below is the only thing that
        // will ever clean it up. Filtering it out of the scan would leave it there forever.
        categoryId: true,
        labels: {
          where: { labelId: id },
          select: { id: true },
        },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });

    if (transactions.length === 0) break;

    const toInsert: { transactionId: string; labelId: string }[] = [];
    // Transactions to unlink from this label, not the link rows themselves. `tx.labels` is already
    // filtered to `labelId: id`, so the two name the same set -- but the delete matches on
    // `(transaction_id, label_id)`, which is the identity meant here and the one that survives a
    // concurrent writer removing and re-adding the pair under a new link-row id.
    const toRemoveFrom: string[] = [];

    for (const tx of transactions) {
      const matchedLabelId = matchScheduledLabel(tx.date, ctx, tx.type, tx.categoryId);
      const hasLabel = tx.labels.length > 0;

      if (matchedLabelId === id && !hasLabel) {
        toInsert.push({ transactionId: tx.id, labelId: id });
      } else if (matchedLabelId !== id && hasLabel) {
        // Schedule no longer matches (narrowed window or lost to overlap) — remove stale
        toRemoveFrom.push(tx.id);
      }
    }

    // Every transaction this pass actually changes. Both branches below fill it from what their
    // write really did, never from the page read that planned it.
    const touchedIds = new Set<string>();

    // One transaction per batch, because the stamp is not repairable on a retry. If the audit
    // update failed after an independently committed association write, the association would
    // stand while the row went on naming its previous MCP editor -- and a rerun sees the
    // associations already in their desired state, leaves `touchedIds` empty and skips the stamp
    // again, so the wrong provenance is permanent. The pass was never atomic *across* batches and
    // still is not; this makes each batch all-or-nothing, which is what the retry needs.
    //
    // Opened only when there is something to write. A re-run over a settled label walks every
    // page finding nothing to do, and an empty transaction per page is a round trip bought for
    // no reason.
    if (toInsert.length > 0 || toRemoveFrom.length > 0) {
      await prisma.$transaction(async (db) => {
        if (toInsert.length > 0) {
          // Derived from what the insert actually created, not from the page read that planned
          // it. That read happens outside this transaction, so a concurrent MCP edit adding the
          // same label first makes `skipDuplicates` insert nothing while the row is still in
          // `toInsert` -- stamping it would overwrite an accurate MCP trail with `APP` for a
          // change this pass did not make. `createManyAndReturn` returns only the rows inserted.
          const created = await db.transactionLabel.createManyAndReturn({
            data: toInsert,
            skipDuplicates: true,
            select: { transactionId: true },
          });
          applied += created.length;
          for (const link of created) touchedIds.add(link.transactionId);
        }

        if (toRemoveFrom.length > 0) {
          // Derived from what the delete actually removed, for the same reason the insert above
          // is. The page read happens outside this transaction, so a concurrent MCP edit that
          // removed the same link first made this a partial no-op while every planned row was
          // stamped `APP` anyway, over an accurate MCP trail (#251). `deleteMany` reports only a
          // count, so `removeTransactionLabels` uses `DELETE ... RETURNING`; see its note.
          const result = await removeTransactionLabels(db, userId, toRemoveFrom, [id]);
          removed += result.linkCount;
          for (const transactionId of result.transactionIds) touchedIds.add(transactionId);
        }

        // Retroactive apply is a user-initiated edit of these transactions' labels, so it stamps
        // the audit columns exactly as `PUT /api/transactions/[id]` and the bulk PATCH do (#232).
        // Without it a row edited over MCP and then retro-labelled here would go on naming the
        // MCP token as its last editor.
        //
        // Deliberately scoped to *this* route. Associations also disappear when a label's type is
        // narrowed or the label is deleted, and those are edits to the **label**, not to the
        // transactions that happen to reference it; stamping there would record an edit on every
        // row a user touched by renaming one thing.
        if (touchedIds.size > 0) {
          await db.transaction.updateMany({
            where: { id: { in: [...touchedIds] }, userId },
            data: { updatedVia: "APP", updatedByMcpTokenId: null },
          });
        }
      });
    }

    cursor = transactions[transactions.length - 1].id;
    if (transactions.length < BATCH_SIZE) break;
  }

  return NextResponse.json({ applied, removed });
}
