import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { telegramQuickTileOrderSchema } from "@/lib/validations";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { quickTileStatus, reorderQuickTiles } from "@/lib/quick-tile-writes";

/**
 * Rewriting the grid order.
 *
 * Takes the **whole** set of ids rather than a moved id and a position. A partial reorder has to
 * be interpreted against whatever the server currently holds, and two drags in flight from a
 * webview that Telegram can reload at any moment would interpret it differently. Sending the full
 * intended order makes the request self-describing: whatever arrives last is what the user last
 * saw. The rule itself lives in `src/lib/quick-tile-writes.ts`, shared with the web page's own
 * reorder route.
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

  try {
    const result = await reorderQuickTiles(prisma, userId, parsed.data.ids);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message },
        { status: quickTileStatus(result.reason) }
      );
    }

    return NextResponse.json({ tiles: result.tiles });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
