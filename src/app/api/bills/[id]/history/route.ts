import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  // Verify ownership
  const bill = await prisma.scheduledTransaction.findUnique({ where: { id } });
  if (!bill || bill.userId !== userId) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip = (page - 1) * limit;

  const [rawLogs, total] = await Promise.all([
    prisma.scheduledTransactionLog.findMany({
      where: { scheduledTransactionId: id },
      orderBy: { dueDate: "desc" },
      skip,
      take: limit,
    }),
    prisma.scheduledTransactionLog.count({
      where: { scheduledTransactionId: id },
    }),
  ]);

  // Batch-fetch linked transaction amounts for PAID entries
  const txIds = rawLogs
    .filter((log) => log.transactionId)
    .map((log) => log.transactionId as string);

  const transactions = txIds.length > 0
    ? await prisma.transaction.findMany({
        where: { id: { in: txIds } },
        select: { id: true, amount: true },
      })
    : [];

  const txAmountMap = new Map(transactions.map((tx) => [tx.id, tx.amount]));

  const logs = rawLogs.map((log) => ({
    ...log,
    paidAmount: log.transactionId ? txAmountMap.get(log.transactionId) ?? null : null,
  }));

  return NextResponse.json({
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
