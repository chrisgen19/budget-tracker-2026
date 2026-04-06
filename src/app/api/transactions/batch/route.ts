import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { batchTransactionSchema } from "@/lib/validations";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";

const batchSchema = z.object({
  transactions: z.array(batchTransactionSchema).min(1).max(50),
});

const batchDeleteSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const { transactions } = batchSchema.parse(body);

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

    // Fetch schedule context for auto-tagging (short-circuits when no schedules exist)
    const ctx = await getScheduleContext(userId);

    const created = await prisma.$transaction(
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
          resolvedLabelIds = t.labelIds.filter((id) => {
            const applicableTo = ownedLabelMap.get(id);
            return applicableTo === "BOTH" || applicableTo === t.type;
          });
        }

        return prisma.transaction.create({
          data: {
            amount: t.amount,
            description: t.description,
            type: t.type,
            date: txDate,
            categoryId: t.categoryId,
            userId,
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
          include: { category: true, labels: { include: { label: true } } },
        });
      })
    );

    return NextResponse.json({ transactions: created }, { status: 201 });
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
