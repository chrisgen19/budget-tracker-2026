import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { scheduledTransactionSchema } from "@/lib/validations";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const existing = await prisma.scheduledTransaction.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const body = await request.json();
    const validated = scheduledTransactionSchema.parse(body);

    const startDate = new Date(validated.startDate);

    // Recalculate nextDueDate if frequency or startDate changed
    const frequencyChanged = validated.frequency !== existing.frequency
      || validated.customIntervalDays !== existing.customIntervalDays;
    const startDateChanged = startDate.getTime() !== existing.startDate.getTime();
    const needsRecalculate = frequencyChanged || startDateChanged;

    const bill = await prisma.scheduledTransaction.update({
      where: { id },
      data: {
        amount: validated.amount,
        description: validated.description,
        type: validated.type,
        frequency: validated.frequency,
        customIntervalDays: validated.customIntervalDays ?? null,
        reminderDaysBefore: validated.reminderDaysBefore,
        startDate,
        endDate: validated.endDate ? new Date(validated.endDate) : null,
        ...(needsRecalculate && { nextDueDate: startDate }),
        categoryId: validated.categoryId,
      },
      include: { category: true },
    });

    return NextResponse.json(bill);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update bill" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.scheduledTransaction.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  // Soft delete — preserves history
  await prisma.scheduledTransaction.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ message: "Bill deactivated" });
}
