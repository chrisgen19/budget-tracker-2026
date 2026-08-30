import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { MAX_BULK_TRANSACTIONS, selectionSnapshotSchema } from "@/lib/transaction-bulk";
import {
  buildTransactionOrderBy,
  buildTransactionWhere,
  transactionFilterSchema,
} from "@/lib/transaction-filter-query";

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { filters: rawFilters, timezoneOffset } = selectionSnapshotSchema.parse(
      await request.json(),
    );
    const filters = transactionFilterSchema.parse({ ...rawFilters, timezoneOffset });
    const transactions = await prisma.transaction.findMany({
      where: buildTransactionWhere(userId, filters),
      orderBy: buildTransactionOrderBy(filters),
      take: MAX_BULK_TRANSACTIONS + 1,
      select: { id: true, description: true, type: true, amount: true },
    });

    if (transactions.length > MAX_BULK_TRANSACTIONS) {
      return NextResponse.json(
        {
          error: `Select at most ${MAX_BULK_TRANSACTIONS.toLocaleString()} transactions at once`,
          max: MAX_BULK_TRANSACTIONS,
        },
        { status: 413 },
      );
    }

    return NextResponse.json({ transactions, count: transactions.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid selection filters" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to select transactions" }, { status: 500 });
  }
}
