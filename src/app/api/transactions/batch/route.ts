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

    // Fetch schedule context for auto-tagging (short-circuits when no schedules exist)
    const ctx = await getScheduleContext(userId);

    const created = await prisma.$transaction(
      transactions.map((t) => {
        const txDate = new Date(t.date);
        const scheduledLabelId = ctx ? matchScheduledLabel(txDate, ctx, t.type) : null;

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
            ...(scheduledLabelId && {
              labels: {
                create: { labelId: scheduledLabelId },
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
