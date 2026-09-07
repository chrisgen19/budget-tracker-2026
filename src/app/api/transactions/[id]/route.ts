import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { transactionSchema } from "@/lib/validations";
import { categoriesAreUsable } from "@/lib/transaction-writes";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const transactionIdSchema = z.string().trim().min(1).max(100);

export async function GET(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { id: rawId } = await params;
    const id = transactionIdSchema.parse(rawId);
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
      include: { category: true, bill: true, labels: { include: { label: true } } },
    });

    if (!transaction) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    return NextResponse.json(transaction);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid transaction ID" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load transaction" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    // Verify ownership
    const existing = await prisma.transaction.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const body = await request.json();
    const validated = transactionSchema.parse(body);

    // Validate the category the same way the create path does. The foreign key only requires the
    // row to exist -- not that it is this user's, and not that its type matches -- so without this
    // an EXPENSE could be filed under an INCOME category, or another user's category attached and
    // then rendered back by the `include` below (#229). `transactionSchema` requires both fields on
    // every PUT, so `validated` is the effective row and needs no merge with `existing`.
    if (!(await categoriesAreUsable(prisma, userId, [validated]))) {
      return NextResponse.json(
        { error: "The category is invalid, does not belong to you, or does not match the transaction type" },
        { status: 400 }
      );
    }

    // Validate label ownership before writing (only when labelIds is explicitly provided)
    const hasLabelIds = validated.labelIds !== undefined;
    const verifiedLabelIds: string[] = [];
    let shouldSyncLabels = hasLabelIds;

    if (hasLabelIds && validated.labelIds!.length > 0) {
      const ownedLabels = await prisma.label.findMany({
        where: { id: { in: validated.labelIds! }, userId },
        select: { id: true, applicableTo: true },
      });
      if (ownedLabels.length !== validated.labelIds!.length) {
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

    // Server-side label reconciliation when labelIds not provided (cold-cache edits, hidden-label flows).
    // Always runs to enforce type compatibility, even for users without schedules.
    if (!hasLabelIds) {
      const existingLabels = await prisma.transactionLabel.findMany({
        where: { transactionId: id },
        include: { label: { select: { applicableTo: true } } },
      });

      // Preserve existing labels, only dropping those incompatible with the
      // (possibly changed) transaction type. We never re-apply scheduled labels
      // on edit — preserving as-is respects prior user overrides.
      for (const el of existingLabels) {
        if (el.label.applicableTo !== "BOTH" && el.label.applicableTo !== validated.type) continue;
        verifiedLabelIds.push(el.labelId);
      }
      shouldSyncLabels = true;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id },
        data: {
          amount: validated.amount,
          description: validated.description,
          type: validated.type,
          date: new Date(validated.date),
          categoryId: validated.categoryId,
        },
      });

      // Sync labels when labelIds was explicitly provided or computed server-side
      if (shouldSyncLabels) {
        await tx.transactionLabel.deleteMany({ where: { transactionId: id } });

        if (verifiedLabelIds.length > 0) {
          await tx.transactionLabel.createMany({
            data: verifiedLabelIds.map((labelId) => ({
              transactionId: id,
              labelId,
            })),
          });
        }
      }

      return tx.transaction.findUniqueOrThrow({
        where: { id },
        include: { category: true, bill: true, labels: { include: { label: true } } },
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.transaction.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  await prisma.transaction.delete({ where: { id } });

  return NextResponse.json({ message: "Transaction deleted" });
}
