import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { labelSchema } from "@/lib/validations";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const labels = await prisma.label.findMany({
    where: { userId },
    include: {
      _count: { select: { transactions: true } },
      schedules: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(labels);
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = labelSchema.parse(body);

    const existing = await prisma.label.findFirst({
      where: { name: { equals: validated.name, mode: "insensitive" }, userId },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A label with this name already exists" },
        { status: 400 }
      );
    }

    const label = await prisma.label.create({
      data: {
        name: validated.name,
        color: validated.color,
        userId,
        ...(validated.schedules && validated.schedules.length > 0 && {
          schedules: {
            create: validated.schedules.map((s) => ({
              days: s.days,
              startTime: s.startTime,
              endTime: s.endTime,
            })),
          },
        }),
      },
      include: {
        _count: { select: { transactions: true } },
        schedules: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json(label, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create label" }, { status: 500 });
  }
}
