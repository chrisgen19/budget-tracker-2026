import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { labelSchema } from "@/lib/validations";
import { createLabel, LABEL_INCLUDE } from "@/lib/label-writes";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const labels = await prisma.label.findMany({
    where: { userId },
    include: LABEL_INCLUDE,
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

    // Shared with the MCP `create_label` tool, so the case-insensitive duplicate rule cannot
    // diverge between the two.
    const result = await createLabel({
      prisma,
      userId,
      name: validated.name,
      color: validated.color,
      applicableTo: validated.applicableTo,
      schedules: validated.schedules,
      categoryIds: validated.categoryIds,
    });

    if (!result.ok) {
      // The category failure carries its own message because it names the offending categories,
      // and "a label with this name already exists" would be actively misleading there.
      return NextResponse.json(
        {
          error:
            result.reason === "INVALID_CATEGORIES"
              ? result.message
              : "A label with this name already exists",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(result.label, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create label" }, { status: 500 });
  }
}
