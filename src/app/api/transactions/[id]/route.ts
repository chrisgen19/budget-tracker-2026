import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { transactionSchema } from "@/lib/validations";

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

    // Validate label ownership before writing
    const verifiedLabelIds: string[] = [];
    if (validated.labelIds && validated.labelIds.length > 0) {
      const ownedLabels = await prisma.label.findMany({
        where: { id: { in: validated.labelIds }, userId },
        select: { id: true },
      });
      if (ownedLabels.length !== validated.labelIds.length) {
        return NextResponse.json(
          { error: "One or more labels are invalid or do not belong to you" },
          { status: 400 }
        );
      }
      verifiedLabelIds.push(...ownedLabels.map((l) => l.id));
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

      // Sync labels: delete all existing, recreate from input
      await tx.transactionLabel.deleteMany({ where: { transactionId: id } });

      if (verifiedLabelIds.length > 0) {
        await tx.transactionLabel.createMany({
          data: verifiedLabelIds.map((labelId) => ({
            transactionId: id,
            labelId,
          })),
        });
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
