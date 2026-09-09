import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { loadFrequentTiles } from "@/lib/telegram/frequent-tiles-query";
import { listTileCategories, listTileRows, viewTiles } from "@/lib/telegram/tile-queries";
import { MAX_QUICK_TILES } from "@/lib/telegram/quick-tiles";

/**
 * Everything the quick-log grid needs, in one request.
 *
 * One round trip rather than four, because a webview cold start is the slow moment: Telegram opens
 * a browser, fetches the page and the SDK, and only then can the app ask for anything. Four
 * sequential requests there is the difference between a grid that is ready when the animation
 * finishes and one that is not.
 *
 * Pinned to the Node runtime. `getTelegramUserId` reaches `init-data.ts`, which uses `node:crypto`,
 * and nothing may pull that into an edge bundle. Node is the default today; this says so out loud
 * so a future change of default cannot silently break the gate.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getTelegramUserId(request);
  if (userId instanceof NextResponse) return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true, timezoneOffset: true },
  });
  // The gate resolved this id from the link column a moment ago, so an absent row means the
  // account was deleted mid-request. Nothing useful to say, and nothing to serve.
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [categories, labels, tileRows] = await Promise.all([
    listTileCategories(prisma, userId),
    // Read for the same reason `categories` is: a tile carries pinned label *ids*, and whether a
    // pin still applies depends on the label's current `applicableTo`, which can be narrowed
    // underneath a button that was valid when it was saved.
    prisma.label.findMany({
      where: { userId },
      select: { id: true, name: true, color: true, applicableTo: true },
    }),
    listTileRows(prisma, userId),
  ]);

  const tiles = viewTiles(tileRows, categories, labels);

  // Derived after the tiles, because it needs their descriptions to avoid offering the same
  // button twice. Sequential on purpose: the exclusion is the point, and running it in parallel
  // would mean deriving a list and then filtering it here, which is the same work done later and
  // in a second place.
  const frequent = await loadFrequentTiles(prisma, userId, user.timezoneOffset, {
    excludeKeys: tiles.map((t) => t.description),
  });

  return NextResponse.json({
    user: { currency: user.currency, timezoneOffset: user.timezoneOffset },
    tiles,
    frequent,
    // Sent so the editor can offer a category picker without a second round trip. The grid itself
    // does not need them -- every tile already carries its resolved name.
    categories,
    limits: { maxTiles: MAX_QUICK_TILES },
  });
}
