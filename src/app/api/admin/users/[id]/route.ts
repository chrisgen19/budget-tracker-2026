import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { z } from "zod";

const updateRoleSchema = z.object({
  role: z.enum(["FREE", "PAID"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;

  try {
    const body = await request.json();
    const { role } = updateRoleSchema.parse(body);

    // Prevent changing own role
    if (id === admin.id) {
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent changing another admin's role
    if (user.role === "ADMIN") {
      return NextResponse.json(
        { error: "Cannot change another admin's role" },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to update user role" },
      { status: 500 }
    );
  }
}
