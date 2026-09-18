import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { savingsGoalSchema } from "@/lib/validations";
import { buildGoalData, getSavingsGoals } from "@/lib/savings-goals";

/** GET /api/goals?includeArchived - every goal with its funded amount and pace. */
export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return NextResponse.json(await getSavingsGoals(prisma, userId, { includeArchived }));
  } catch (error) {
    console.error("[goals] load failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to load savings goals" }, { status: 500 });
  }
}

/** POST /api/goals - create one. */
export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = savingsGoalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid goal" }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezoneOffset: true } });
    const goal = await prisma.savingsGoal.create({
      data: { userId, ...buildGoalData(parsed.data) },
      select: { id: true },
    });
    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    // `@@unique([userId, name])`. Reported as the conflict it is rather than a 500: two goals
    // called "House" are indistinguishable in every list the app shows.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A goal with that name already exists" }, { status: 409 });
    }
    console.error("[goals] create failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to create savings goal" }, { status: 500 });
  }
}
