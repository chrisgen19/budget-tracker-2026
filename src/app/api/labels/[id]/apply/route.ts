import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";

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
    include: { schedules: true },
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
    const toRemoveIds: string[] = [];

    for (const tx of transactions) {
      const matchedLabelId = matchScheduledLabel(tx.date, ctx, tx.type);
      const hasLabel = tx.labels.length > 0;

      if (matchedLabelId === id && !hasLabel) {
        toInsert.push({ transactionId: tx.id, labelId: id });
      } else if (matchedLabelId !== id && hasLabel) {
        // Schedule no longer matches (narrowed window or lost to overlap) — remove stale
        toRemoveIds.push(...tx.labels.map((tl) => tl.id));
      }
    }

    // Every transaction this pass actually changes, collected before the writes so the removals
    // can still be attributed once their link rows are gone.
    const touchedIds = new Set<string>();

    if (toInsert.length > 0) {
      const result = await prisma.transactionLabel.createMany({
        data: toInsert,
        skipDuplicates: true,
      });
      applied += result.count;
      for (const link of toInsert) touchedIds.add(link.transactionId);
    }

    if (toRemoveIds.length > 0) {
      const removedLinks = transactions.filter((tx) =>
        tx.labels.some((tl) => toRemoveIds.includes(tl.id))
      );
      const result = await prisma.transactionLabel.deleteMany({
        where: { id: { in: toRemoveIds } },
      });
      removed += result.count;
      for (const tx of removedLinks) touchedIds.add(tx.id);
    }

    // Retroactive apply is a user-initiated edit of these transactions' labels, so it stamps the
    // audit columns exactly as `PUT /api/transactions/[id]` and the bulk PATCH do. Without it a
    // row edited over MCP and then retro-labelled here would go on naming the MCP token as its
    // last editor.
    //
    // Deliberately scoped to *this* route. Associations also disappear when a label's type is
    // narrowed or the label is deleted, and those are edits to the **label**, not to the
    // transactions that happen to reference it; stamping there would record an edit on every row
    // a user touched by renaming one thing.
    if (touchedIds.size > 0) {
      await prisma.transaction.updateMany({
        where: { id: { in: [...touchedIds] }, userId },
        data: { updatedVia: "APP", updatedByMcpTokenId: null },
      });
    }

    cursor = transactions[transactions.length - 1].id;
    if (transactions.length < BATCH_SIZE) break;
  }

  return NextResponse.json({ applied, removed });
}
