import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { transactionSchema } from "@/lib/validations";
import { getScheduleContext, matchScheduledLabel } from "@/lib/schedule-server";

interface RouteParams {
  params: Promise<{ id: string }>;
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

    // Server-side label reconciliation when labelIds not provided (cold-cache edits, hidden-label flows)
    if (!hasLabelIds) {
      const [ctx, existingLabels] = await Promise.all([
        getScheduleContext(userId),
        prisma.transactionLabel.findMany({
          where: { transactionId: id },
          include: { label: { select: { applicableTo: true } } },
        }),
      ]);

      if (ctx) {
        const scheduledId = matchScheduledLabel(new Date(validated.date), ctx, validated.type);

        for (const el of existingLabels) {
          const isScheduled = ctx.scheduledLabelIds.has(el.labelId);
          // Drop stale scheduled labels (date moved outside window or lost overlap)
          if (isScheduled && el.labelId !== scheduledId) continue;
          // Drop labels incompatible with the (possibly changed) transaction type
          if (el.label.applicableTo !== "BOTH" && el.label.applicableTo !== validated.type) continue;
          verifiedLabelIds.push(el.labelId);
        }
        // Never auto-add scheduled labels on edits — absence of a scheduled label
        // is treated as an intentional user override (e.g. quick-removed from list view).
        // Scheduled labels are only auto-added on transaction *creation*.
        shouldSyncLabels = true;
      }
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
