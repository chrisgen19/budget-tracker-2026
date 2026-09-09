import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientBatchIdSchema, telegramQuickLogSchema } from "@/lib/validations";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { findReplayedQuickLog, logQuickTile, quickTileStatus } from "@/lib/quick-tile-writes";

/**
 * A tap on the quick-log grid, from inside Telegram.
 *
 * Writes through `createTransactionBatch`, the app's single create path, so the label resolution
 * rules, the category-ownership check and the advisory-lock idempotency all apply unchanged.
 *
 * **Not** through `/api/mcp`, which is how the bot writes. That would mean either an MCP token in
 * browser code -- a leaked credential -- or a loopback proxy holding `TELEGRAM_MCP_TOKEN`, which
 * would put every tap behind `users.mcp_writes_enabled_until`. That lease is a kill switch for
 * agents and is designed to lapse; a button that stops working whenever it does is not a button.
 *
 * The tap itself lives in `logQuickTile` (`src/lib/quick-tile-writes.ts`), shared with the web
 * page's `/api/quick-tiles/log`. `createdVia` is the one thing that differs between them, and it
 * is passed rather than derived: provenance follows the surface the user tapped.
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

  // A replay creates nothing, so it must not be judged on references it will never use.
  //
  // Tiles and categories are mutable. If the first write committed but its response was lost, and
  // the tile was deleted before the retry, resolving it first would 404 a batch that is already
  // saved -- and the client reads a 4xx as proof nothing was written, drops its idempotency pin,
  // and a corrected resubmit under a fresh key duplicates a real transaction. `transaction-writes`
  // states the rule and `POST /api/transactions/batch` guards it the same way; this route has the
  // same two 4xx branches ahead of its write, so it needs the same guard.
  //
  // Read off the raw body ahead of `safeParse` for the same reason the batch route does: any later
  // tightening of the payload schema would otherwise reject a replay of a batch accepted under the
  // previous one, which is the identical failure a step further out. A key that is absent or
  // malformed cannot match anything and simply falls through to normal validation. The
  // authoritative dedupe still happens under the advisory lock inside `createTransactionBatch`;
  // this is that check without the preconditions, not a replacement for it.
  const providedKey = clientBatchIdSchema.safeParse(
    (body as { clientBatchId?: unknown } | null)?.clientBatchId
  );
  if (providedKey.success) {
    const replayed = await findReplayedQuickLog(prisma, userId, providedKey.data);
    if (replayed) return NextResponse.json(replayed, { status: 200 });
  }

  const parsed = telegramQuickLogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const result = await logQuickTile(prisma, userId, parsed.data, "TELEGRAM");
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: quickTileStatus(result.reason) }
    );
  }

  const { ok: _ok, ...payload } = result;
  return NextResponse.json(payload, { status: payload.replayed ? 200 : 201 });
}
