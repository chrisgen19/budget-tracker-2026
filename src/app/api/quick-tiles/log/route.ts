import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { clientBatchIdSchema, telegramQuickLogSchema } from "@/lib/validations";
import { findReplayedQuickLog, logQuickTile, quickTileStatus } from "@/lib/quick-tile-writes";

/**
 * One tap on the web app's quick-log grid.
 *
 * The same `logQuickTile` the Mini App's tap runs, with one difference passed explicitly:
 * `createdVia: "APP"`. Provenance follows the surface the user actually tapped, not the code path
 * -- a row written from a laptop should not claim Telegram wrote it, and `created_via` is the only
 * column that can say which.
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

  // The replay check runs **before** validation and before the tile is resolved. A replay creates
  // nothing, so it must not be judged on references it will never use: if the first write
  // committed but its response was lost and the button was deleted before the retry, resolving
  // first would 404 a batch that is already saved -- and the client reads a 4xx as proof nothing
  // was written, drops its idempotency pin, and a resubmit under a fresh key duplicates a real
  // transaction. Read off the raw body for the same reason `POST /api/transactions/batch` does:
  // a later tightening of the payload schema must not reject a replay of a batch accepted under
  // the previous one.
  const providedKey = clientBatchIdSchema.safeParse(
    (body as { clientBatchId?: unknown } | null)?.clientBatchId
  );

  // The guard covers the replay lookup as well as the write, and it answers **500**, which is the
  // load-bearing part: the client reads a 4xx as proof nothing was written and drops its
  // idempotency pin. An unexpected throw here is precisely the case where whether the row
  // committed is unknown, so it must keep the pin and replay rather than post again.
  try {
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

    const result = await logQuickTile(prisma, userId, parsed.data, "APP");
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, reason: result.reason },
        { status: quickTileStatus(result.reason) }
      );
    }

    const { ok: _ok, ...payload } = result;
    return NextResponse.json(payload, { status: payload.replayed ? 200 : 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
