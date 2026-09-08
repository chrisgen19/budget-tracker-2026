import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { telegramQuickTileOrderSchema } from "@/lib/validations";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { SORT_ORDER_GAP } from "@/lib/telegram/quick-tiles";
import { listTileCategories, listTileRows, viewTiles } from "@/lib/telegram/tile-queries";

/**
 * Rewriting the grid order.
 *
 * Takes the **whole** set of ids rather than a moved id and a position. A partial reorder has to
 * be interpreted against whatever the server currently holds, and two drags in flight from a
 * webview that Telegram can reload at any moment would interpret it differently. Sending the full
 * intended order makes the request self-describing: whatever arrives last is what the user last
 * saw.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await getTelegramUserId(request);
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = telegramQuickTileOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { ids } = parsed.data;

  const owned = await prisma.telegramQuickTile.findMany({
    where: { userId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((t) => t.id));

  // Exactly this user's tiles, no more and no fewer. A foreign id spliced in must not be written,
  // and an id left out would keep its old `sortOrder` and land somewhere the user did not put it.
  // Both are refusals rather than partial applications: a reorder that half-applies leaves a grid
  // nobody arranged.
  const sameSet =
    ids.length === ownedIds.size && ids.every((id) => ownedIds.has(id));

  if (!sameSet) {
    return NextResponse.json(
      { error: "Send exactly your current tile ids, in the order you want them." },
      { status: 400 }
    );
  }

  // One transaction, so a failure partway leaves the previous order intact rather than a grid
  // half in the old arrangement and half in the new one.
  try {
    await prisma.$transaction(
      ids.map((id, i) =>
        prisma.telegramQuickTile.update({
          where: { id },
          data: { sortOrder: (i + 1) * SORT_ORDER_GAP },
        })
      )
    );
  } catch (error) {
    // The set was read before the transaction opened, so a tile deleted in between is named here
    // and no longer exists. `update` raises P2025 and the whole transaction rolls back, which is
    // the right outcome -- the wrong one was letting it surface as an unhandled 500 with no JSON
    // body. The order the client sent describes a grid that no longer exists, so the honest answer
    // is to say so and let it refetch, not to guess which position the missing tile freed up.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { error: "Your buttons changed while you were reordering them. Reload and try again." },
        { status: 409 }
      );
    }
    throw error;
  }

  const [categories, rows] = await Promise.all([
    listTileCategories(prisma, userId),
    listTileRows(prisma, userId),
  ]);

  return NextResponse.json({ tiles: viewTiles(rows, categories) });
}
