import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { categorySchema } from "@/lib/validations";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  const where: Record<string, unknown> = {
    OR: [{ isDefault: true }, { userId }],
  };

  if (type === "INCOME" || type === "EXPENSE") {
    where.type = type;
  }

  const categories = await prisma.category.findMany({
    where,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(categories);
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = categorySchema.parse(body);

    // Check for duplicate name + type for this user
    const existing = await prisma.category.findFirst({
      where: {
        name: validated.name,
        type: validated.type,
        OR: [{ userId }, { isDefault: true }],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A category with this name already exists" },
        { status: 400 }
      );
    }

    const category = await prisma.category.create({
      data: {
        name: validated.name,
        type: validated.type,
        icon: validated.icon,
        color: validated.color,
        isDefault: false,
        userId,
      },
    });

    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
