import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { batchTransactionSchema } from "@/lib/validations";

const batchSchema = z.object({
  transactions: z.array(batchTransactionSchema).min(1).max(50),
});

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const { transactions } = batchSchema.parse(body);

    // Use prisma.$transaction with individual creates so we get `include: { category: true }`
    const created = await prisma.$transaction(
      transactions.map((t) =>
        prisma.transaction.create({
          data: {
            amount: t.amount,
            description: t.description,
            type: t.type,
            date: new Date(t.date),
            categoryId: t.categoryId,
            userId,
            ...(t.receiptGroupId && { receiptGroupId: t.receiptGroupId }),
            ...(t.receiptBreakdown && { receiptBreakdown: t.receiptBreakdown }),
          },
          include: { category: true },
        })
      )
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
