import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { batchTransactionSchema } from "@/lib/validations";
import { getScheduledLabelId, type ScheduleRule } from "@/lib/schedule-matching";

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

    // Fetch labels with schedules + user timezone for auto-tagging
    const [labelsWithSchedules, user] = await Promise.all([
      prisma.label.findMany({
        where: { userId, schedules: { some: {} } },
        include: { schedules: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezoneOffset: true },
      }),
    ]);

    const scheduleRules: ScheduleRule[] = labelsWithSchedules.flatMap((label) =>
      label.schedules.map((s) => ({
        labelId: label.id,
        labelCreatedAt: label.createdAt,
        days: s.days,
        startTime: s.startTime,
        endTime: s.endTime,
      }))
    );

    const created = await prisma.$transaction(
      transactions.map((t) => {
        const txDate = new Date(t.date);
        const scheduledLabelId = scheduleRules.length > 0
          ? getScheduledLabelId(txDate, user.timezoneOffset, scheduleRules)
          : null;

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
