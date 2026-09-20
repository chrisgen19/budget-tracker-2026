import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";

interface RouteParams {
  params: Promise<{ id: string; contributionId: string }>;
}

/**
 * DELETE one contribution.
 *
 * Scoped through the goal's own `userId` in a single statement. A `deleteMany` on the contribution
 * id alone would delete anybody's row that happened to be named, and a read-then-check would be
 * two statements with a window between them.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { id, contributionId } = await params;
    const { count } = await prisma.savingsGoalContribution.deleteMany({
      where: { id: contributionId, goalId: id, goal: { userId } },
    });
    if (count === 0) return NextResponse.json({ error: "Contribution not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[goals/contributions] delete failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to delete contribution" }, { status: 500 });
  }
}
