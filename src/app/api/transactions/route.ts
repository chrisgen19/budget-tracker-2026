import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { transactionSchema } from "@/lib/validations";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";
import {
  buildTransactionOrderBy,
  buildTransactionWhere,
  parseTransactionSearchParams,
} from "@/lib/transaction-filter-query";
import { z } from "zod";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { searchParams } = new URL(request.url);
    const filters = parseTransactionSearchParams(searchParams);
    const page = z.coerce.number().int().min(1).catch(1).parse(searchParams.get("page"));
    const limit = z.coerce.number().int().min(1).max(100).catch(20).parse(searchParams.get("limit"));
    const where = buildTransactionWhere(userId, filters);
    const orderBy = buildTransactionOrderBy(filters);

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: { category: true, bill: true, labels: { include: { label: true } } },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return NextResponse.json({
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid transaction filters" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load transactions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = transactionSchema.parse(body);

    // Validate label ownership and type compatibility before writing
    const verifiedLabelIds: string[] = [];
    if (validated.labelIds && validated.labelIds.length > 0) {
      const uniqueLabelIds = [...new Set(validated.labelIds)];
      const ownedLabels = await prisma.label.findMany({
        where: { id: { in: uniqueLabelIds }, userId },
        select: { id: true, applicableTo: true },
      });
      if (ownedLabels.length !== uniqueLabelIds.length) {
        return NextResponse.json(
          { error: "One or more labels are invalid or do not belong to you" },
          { status: 400 }
        );
      }
      // Only keep labels compatible with the transaction type
      const compatible = ownedLabels.filter(
        (l) => l.applicableTo === "BOTH" || l.applicableTo === validated.type
      );
      verifiedLabelIds.push(...compatible.map((l) => l.id));
    }

    // Server-side auto-label when labelIds not provided (hidden-label flows, external callers).
    // When labelIds is explicitly [] the user opted out — respect that.
    if (validated.labelIds === undefined) {
      const ctx = await getScheduleContext(userId);
      if (ctx) {
        const scheduledId = matchScheduledLabel(new Date(validated.date), ctx, validated.type);
        if (scheduledId) verifiedLabelIds.push(scheduledId);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          amount: validated.amount,
          description: validated.description,
          type: validated.type,
          date: new Date(validated.date),
          categoryId: validated.categoryId,
          userId,
        },
      });

      if (verifiedLabelIds.length > 0) {
        await tx.transactionLabel.createMany({
          data: verifiedLabelIds.map((labelId) => ({
            transactionId: transaction.id,
            labelId,
          })),
        });
      }

      return tx.transaction.findUniqueOrThrow({
        where: { id: transaction.id },
        include: { category: true, bill: true, labels: { include: { label: true } } },
      });
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}
