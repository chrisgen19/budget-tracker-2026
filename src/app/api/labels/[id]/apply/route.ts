import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { getScheduledLabelId, type ScheduleRule } from "@/lib/schedule-matching";

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

  // Fetch ALL user labels with schedules for overlap priority check
  const allLabelsWithSchedules = await prisma.label.findMany({
    where: { userId, schedules: { some: {} } },
    include: { schedules: true },
    orderBy: { createdAt: "asc" },
  });

  const scheduleRules: ScheduleRule[] = allLabelsWithSchedules.flatMap((l) =>
    l.schedules.map((s) => ({
      labelId: l.id,
      labelCreatedAt: l.createdAt,
      days: s.days,
      startTime: s.startTime,
      endTime: s.endTime,
    }))
  );

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezoneOffset: true },
  });

  // Get existing associations for this label to avoid duplicates
  const existingAssociations = await prisma.transactionLabel.findMany({
    where: { labelId: id },
    select: { transactionId: true },
  });
  const existingSet = new Set(existingAssociations.map((a) => a.transactionId));

  // Process transactions in batches using cursor-based pagination
  let applied = 0;
  let cursor: string | undefined;
  const BATCH_SIZE = 500;

  while (true) {
    const transactions = await prisma.transaction.findMany({
      where: { userId },
      select: { id: true, date: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
    });

    if (transactions.length === 0) break;

    const toInsert: { transactionId: string; labelId: string }[] = [];

    for (const tx of transactions) {
      if (existingSet.has(tx.id)) continue;

      const matchedLabelId = getScheduledLabelId(
        tx.date,
        user.timezoneOffset,
        scheduleRules
      );

      if (matchedLabelId === id) {
        toInsert.push({ transactionId: tx.id, labelId: id });
      }
    }

    if (toInsert.length > 0) {
      await prisma.transactionLabel.createMany({
        data: toInsert,
        skipDuplicates: true,
      });
      applied += toInsert.length;
    }

    cursor = transactions[transactions.length - 1].id;
    if (transactions.length < BATCH_SIZE) break;
  }

  return NextResponse.json({ applied });
}
