import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { telegramQuickTilePatchSchema } from "@/lib/validations";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { deleteQuickTile, quickTileStatus, updateQuickTile } from "@/lib/quick-tile-writes";

/**
 * Editing and deleting one quick-log tile.
 *
 * A thin wrapper over `src/lib/quick-tile-writes.ts`, shared with `/api/quick-tiles/[id]`. The
 * effective-row checks and the conditional write live there.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getTelegramUserId(request);
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

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await getTelegramUserId(request);
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
