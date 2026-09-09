import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { telegramQuickTilePatchSchema } from "@/lib/validations";
import { deleteQuickTile, quickTileStatus, updateQuickTile } from "@/lib/quick-tile-writes";

/**
 * Editing and deleting one quick-log button from the web app.
 *
 * A missing button answers **404 rather than 403**, matching the Mini App's route: a 403 confirms
 * that somebody else's button exists, which is itself an answer.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = telegramQuickTilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await updateQuickTile(prisma, userId, id, parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: quickTileStatus(result.reason) }
      );
    }

    return NextResponse.json({ tile: result.tile });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await context.params;

  try {
    const result = await deleteQuickTile(prisma, userId, id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: quickTileStatus(result.reason) }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
