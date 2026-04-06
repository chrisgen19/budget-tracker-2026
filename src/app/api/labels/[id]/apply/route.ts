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

    if (toInsert.length > 0) {
      const result = await prisma.transactionLabel.createMany({
        data: toInsert,
        skipDuplicates: true,
      });
      applied += result.count;
    }

    if (toRemoveIds.length > 0) {
      const result = await prisma.transactionLabel.deleteMany({
        where: { id: { in: toRemoveIds } },
      });
      removed += result.count;
    }

    cursor = transactions[transactions.length - 1].id;
    if (transactions.length < BATCH_SIZE) break;
  }

  return NextResponse.json({ applied, removed });
}
