import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { categorySchema } from "@/lib/validations";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const existing = await prisma.category.findFirst({
      where: { id, userId, isDefault: false },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Category not found or cannot be edited" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validated = categorySchema.parse(body);

    const category = await prisma.category.update({
      where: { id },
      data: {
        name: validated.name,
        type: validated.type,
        icon: validated.icon,
        color: validated.color,
      },
    });

    return NextResponse.json(category);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.category.findFirst({
    where: { id, userId, isDefault: false },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Category not found or cannot be deleted" },
      { status: 404 }
    );
  }

  // Check if category has transactions
  const transactionCount = await prisma.transaction.count({
    where: { categoryId: id },
  });

  if (transactionCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${transactionCount} transaction(s) use this category` },
      { status: 400 }
    );
  }

  await prisma.category.delete({ where: { id } });

  return NextResponse.json({ message: "Category deleted" });
}
