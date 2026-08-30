import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { exportTransactionsSchema } from "@/lib/transaction-bulk";
import { generateTransactionsCsv } from "@/lib/transaction-csv";

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { ids, timezoneOffset } = exportTransactionsSchema.parse(await request.json());
    const transactions = await prisma.transaction.findMany({
      where: { userId, id: { in: ids } },
      include: { category: true, bill: true, labels: { include: { label: true } } },
    });
    const byId = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const ordered = ids.flatMap((id) => {
      const transaction = byId.get(id);
      return transaction ? [transaction] : [];
    });
    const csv = generateTransactionsCsv(ordered, timezoneOffset);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=transactions-selected.csv",
        "X-Exported-Count": String(ordered.length),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid export request" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to export transactions" }, { status: 500 });
  }
}
