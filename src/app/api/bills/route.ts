import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { scheduledTransactionSchema } from "@/lib/validations";

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
    include: { category: true },
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

    const bill = await prisma.scheduledTransaction.create({
      data: {
        amount: validated.amount,
        description: validated.description,
        type: validated.type,
        frequency: validated.frequency,
        customIntervalDays: validated.customIntervalDays ?? null,
        reminderDaysBefore: validated.reminderDaysBefore,
        startDate,
        endDate: validated.endDate ? new Date(validated.endDate) : null,
        nextDueDate: startDate,
        categoryId: validated.categoryId,
        userId,
      },
      include: { category: true },
    });

    return NextResponse.json(bill, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create bill" }, { status: 500 });
  }
}
