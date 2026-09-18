import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { savingsGoalPatchSchema } from "@/lib/validations";
import { getSavingsGoal, goalDayToInstant } from "@/lib/savings-goals";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Every write here scopes on `{ id, userId }` and checks the row count.
 *
 * Not "look it up, then check who owns it": that is two statements and a window between them, and
 * the shape invites a later edit that forgets the second one. A `updateMany` that matches nothing
 * is a 404 for someone else's goal and for a deleted one alike, which is the right answer to both.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const goal = await getSavingsGoal(prisma, userId, (await params).id);
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    return NextResponse.json(goal);
  } catch (error) {
    console.error("[goals/id] load failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to load savings goal" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = savingsGoalPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid goal" }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezoneOffset: true } });
    const patch = parsed.data;
    const data: Prisma.SavingsGoalUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.kind !== undefined) data.kind = patch.kind;
    if (patch.targetAmount !== undefined) data.targetAmount = patch.targetAmount;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.status !== undefined) data.status = patch.status;
    // `undefined` leaves the column alone; an explicit `null` clears the deadline, which is a
    // decision the user is entitled to make and not the same as not mentioning it.
    if (patch.targetDate !== undefined) {
      data.targetDate = patch.targetDate === null
        ? null
        : goalDayToInstant(patch.targetDate);
    }

    const { count } = await prisma.savingsGoal.updateMany({ where: { id: (await params).id, userId }, data });
    if (count === 0) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A goal with that name already exists" }, { status: 409 });
    }
    console.error("[goals/id] update failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to update savings goal" }, { status: 500 });
  }
}

/**
 * DELETE removes a goal that has no contributions. Archiving is what a goal with history gets.
 *
 * The no-history rule is enforced **in the delete's own `where`**, not by reading first and
 * checking. `onDelete: Cascade` means a delete that slips through takes the contributions with it,
 * and "where did my savings record go" is not a question a confirm dialog can un-ask. Only
 * offering the button for an empty goal is not the rule, it is the hint: the page the button was
 * rendered on goes stale the moment another tab records a contribution, and a request can arrive
 * without any page at all.
 *
 * `count === 0` is ambiguous between "not this user's goal" and "it has history", so the cause is
 * resolved with a follow-up read. That read decides a status code and nothing else - the delete
 * already happened or already did not, atomically, against a condition no caller can race.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const goalId = (await params).id;
    const { count } = await prisma.savingsGoal.deleteMany({
      where: { id: goalId, userId, contributions: { none: {} } },
    });
    if (count > 0) return NextResponse.json({ ok: true });

    const survivor = await prisma.savingsGoal.findFirst({
      where: { id: goalId, userId },
      select: { id: true },
    });
    return survivor
      ? NextResponse.json(
          { error: "This goal has contributions. Archive it instead, so the record is kept." },
          { status: 409 },
        )
      : NextResponse.json({ error: "Goal not found" }, { status: 404 });
  } catch (error) {
    console.error("[goals/id] delete failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to delete savings goal" }, { status: 500 });
  }
}
