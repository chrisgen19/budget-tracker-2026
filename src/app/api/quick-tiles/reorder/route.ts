import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { telegramQuickTileOrderSchema } from "@/lib/validations";
import { quickTileStatus, reorderQuickTiles } from "@/lib/quick-tile-writes";

/**
 * Rewriting the grid order from the web app.
 *
 * Takes the **whole** set of ids rather than a moved id and a position, so the request is
 * self-describing and two moves in flight cannot be interpreted differently. Whatever arrives last
 * is what the user last saw.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await getAuthUserId();
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

  const result = await reorderQuickTiles(prisma, userId, parsed.data.ids);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: quickTileStatus(result.reason) });
  }

  return NextResponse.json({ tiles: result.tiles });
}
