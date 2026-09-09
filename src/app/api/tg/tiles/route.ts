import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { telegramQuickTileSchema } from "@/lib/validations";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { createQuickTile, listQuickTiles, quickTileStatus } from "@/lib/quick-tile-writes";

/**
 * Listing and creating quick-log tiles, from the Mini App's editor.
 *
 * A thin wrapper. Every rule -- the tile cap, the duplicate-label refusal, the category and label
 * checks -- lives in `src/lib/quick-tile-writes.ts`, shared with the session-authenticated
 * `/api/quick-tiles` routes the web page uses. Two doors onto the same rows, one set of rules; a
 * second copy would drift the moment either side changed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getTelegramUserId(request);
  if (userId instanceof NextResponse) return userId;

  try {
    return NextResponse.json(await listQuickTiles(prisma, userId));
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await getTelegramUserId(request);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = telegramQuickTileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await createQuickTile(prisma, userId, parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: quickTileStatus(result.reason) }
      );
    }

    return NextResponse.json({ tile: result.tile }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
