import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { loadFrequentTiles } from "@/lib/telegram/frequent-tiles-query";
import { listTileRows } from "@/lib/telegram/tile-queries";

/**
 * What the ledger says you keep logging, offered as buttons you have not made yet.
 *
 * Its own route rather than part of `GET /api/quick-tiles`, because `loadFrequentTiles` reads up
 * to a thousand transaction rows and the configured grid -- the part the user came to use -- must
 * not wait on it. The page renders its buttons and fills this section in when it arrives.
 *
 * `excludeKeys` takes the tiles' raw **descriptions**, not their labels and not pre-folded keys:
 * `deriveFrequentTiles` folds them itself and matches by token-set containment in either
 * direction, which is what stops a configured button reappearing here under a second spelling. A
 * caller passing something already folded would be passing it through a rule that has since moved
 * on. This mirrors `GET /api/tg/bootstrap` exactly, and must keep mirroring it.
 *
 * `timezoneOffset` comes from `users.timezone_offset` and never from `TELEGRAM_TZ_OFFSET`, which
 * describes the bot's prompt clock and would be a second source of truth for the same fact.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const tiles = await listTileRows(prisma, userId);

    const frequent = await loadFrequentTiles(prisma, userId, user.timezoneOffset, {
      excludeKeys: tiles.map((t) => t.description),
    });

    return NextResponse.json({ frequent });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
