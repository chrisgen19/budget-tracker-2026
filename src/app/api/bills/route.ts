import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { scheduledTransactionSchema } from "@/lib/validations";

const billInclude = {
  category: true,
  labels: { include: { label: true } },
} as const;

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const active = searchParams.get("active");
  const type = searchParams.get("type");

  const where: Record<string, unknown> = { userId };

  if (active === "true") where.isActive = true;
  if (active === "false") where.isActive = false;
  if (type === "INCOME" || type === "EXPENSE") where.type = type;

  const bills = await prisma.scheduledTransaction.findMany({
    where,
    include: billInclude,
    orderBy: { nextDueDate: "asc" },
  });

  return NextResponse.json(bills);
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = scheduledTransactionSchema.parse(body);

    const startDate = new Date(validated.startDate);
    const { labelIds, ...billData } = validated;

    // Validate label ownership + type compatibility
    let verifiedLabelIds: string[] = [];
    if (labelIds && labelIds.length > 0) {
      const owned = await prisma.label.findMany({
        where: { id: { in: labelIds }, userId },
        select: { id: true, applicableTo: true },
      });
      verifiedLabelIds = owned
        .filter((l) => l.applicableTo === "BOTH" || l.applicableTo === billData.type)
        .map((l) => l.id);
    }

    const bill = await prisma.scheduledTransaction.create({
      data: {
        amount: billData.amount,
        description: billData.description,
        type: billData.type,
        frequency: billData.frequency,
        customIntervalDays: billData.customIntervalDays ?? null,
        reminderDaysBefore: billData.reminderDaysBefore,
        startDate,
        endDate: billData.endDate ? new Date(billData.endDate) : null,
        nextDueDate: startDate,
        categoryId: billData.categoryId,
        userId,
        ...(verifiedLabelIds.length > 0 && {
          labels: {
            create: verifiedLabelIds.map((id) => ({ labelId: id })),
          },
        }),
      },
      include: billInclude,
    });

    return NextResponse.json(bill, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create bill" }, { status: 500 });
  }
}
