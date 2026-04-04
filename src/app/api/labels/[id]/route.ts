import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { labelSchema } from "@/lib/validations";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const existing = await prisma.label.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Label not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validated = labelSchema.parse(body);

    // Check for duplicate name (excluding self)
    const duplicate = await prisma.label.findFirst({
      where: { name: { equals: validated.name, mode: "insensitive" }, userId, NOT: { id } },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: "A label with this name already exists" },
        { status: 400 }
      );
    }

    const label = await prisma.label.update({
      where: { id },
      data: {
        name: validated.name,
        color: validated.color,
      },
      include: { _count: { select: { transactions: true } } },
    });

    return NextResponse.json(label);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update label" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.label.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Label not found" },
      { status: 404 }
    );
  }

  await prisma.label.delete({ where: { id } });

  return NextResponse.json({ message: "Label deleted" });
}
