import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { savingsGoalContributionSchema } from "@/lib/validations";
import { goalDayToInstant } from "@/lib/savings-goals";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/goals/[id]/contributions - assign money to a goal, or take it back out.
 *
 * A contribution is deliberately **not** a transaction. Moving money into savings is not spending
 * it, and a row written as an EXPENSE would land in every category report, the assessment and the
 * budget as though the money were gone - the same reasoning that keeps `CreditPayment` out of the
 * transactions table.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = savingsGoalContributionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid contribution" }, { status: 400 });
  }

  try {
    const goalId = (await params).id;
    // Ownership is established before the write, not asserted after it: the goal id arrives from
    // the URL and nothing else here would stop a contribution landing in someone else's goal.
    const [goal, user] = await Promise.all([
      prisma.savingsGoal.findFirst({ where: { id: goalId, userId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { timezoneOffset: true } }),
    ]);
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

    const contribution = await prisma.savingsGoalContribution.create({
      data: {
        goalId: goal.id,
        amount: parsed.data.amount,
        date: goalDayToInstant(parsed.data.date, user?.timezoneOffset ?? 0),
        note: parsed.data.note ?? null,
      },
      select: { id: true },
    });
    return NextResponse.json(contribution, { status: 201 });
  } catch (error) {
    console.error("[goals/contributions] create failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save contribution" }, { status: 500 });
  }
}
