import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { telegramQuickTileSchema } from "@/lib/validations";
import { MAX_QUICK_TILES } from "@/lib/telegram/quick-tiles";
import { createQuickTile, listQuickTiles, quickTileStatus } from "@/lib/quick-tile-writes";

/**
 * The web app's door onto the quick-log buttons.
 *
 * The same rows the Telegram Mini App edits through `/api/tg/tiles`, and deliberately so: a button
 * made on a laptop is on the phone's grid on the next launch, with nothing to sync. What differs
 * between the two routes is only which credential is accepted -- a NextAuth session here, a signed
 * `initData` payload there. Every rule lives in `src/lib/quick-tile-writes.ts` and neither route
 * restates one, because a rule stated twice is a rule that will eventually be stated differently.
 *
 * Categories and labels are not returned here. The web page already has `useCategoriesQuery` and
 * `useLabelsQuery` in cache; the Mini App gets them in its bootstrap payload because a webview
 * cold start cannot afford the extra round trips, and that is a constraint this page does not have.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { tiles } = await listQuickTiles(prisma, userId);
    return NextResponse.json({ tiles, limits: { maxTiles: MAX_QUICK_TILES } });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
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
