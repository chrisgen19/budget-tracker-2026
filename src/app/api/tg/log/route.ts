import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createTransactionBatch,
  findSavedBatch,
  type TransactionWithRelations,
} from "@/lib/transaction-writes";
import { clientBatchIdSchema, telegramQuickLogSchema } from "@/lib/validations";
import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";
import { resolveTileCategory } from "@/lib/telegram/quick-tiles";
import { listTileCategories } from "@/lib/telegram/tile-queries";

/**
 * A tap on the quick-log grid.
 *
 * Writes through `createTransactionBatch`, the app's single create path, so the label resolution
 * rules, the category-ownership check and the advisory-lock idempotency all apply unchanged.
 *
 * **Not** through `/api/mcp`, which is how the bot writes. That would mean either an MCP token in
 * browser code -- a leaked credential -- or a loopback proxy holding `TELEGRAM_MCP_TOKEN`, which
 * would put every tap behind `users.mcp_writes_enabled_until`. That lease is a kill switch for
 * agents and is designed to lapse; a button that stops working whenever it does is not a button.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a confirmation says about a row that was already written.
 *
 * `categoryVia` is null rather than re-derived. It describes a decision the *original* request
 * made, and this one did not make it: resolving again could disagree with what was actually
 * stored, which would be a confident answer about an inference that never happened. The category
 * *name* comes off the row and is the truth either way, which is what the confirmation is for.
 */
const replayResponse = (transaction: TransactionWithRelations) => ({
  id: transaction.id,
  amount: transaction.amount,
  description: transaction.description,
  categoryName: transaction.category.name,
  categoryVia: null,
  labels: transaction.labels.map((l) => l.label.name),
  replayed: true,
});

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
    const alreadySaved = await findSavedBatch(prisma, userId, providedKey.data);
    if (alreadySaved.length > 0) {
      return NextResponse.json(replayResponse(alreadySaved[0]), { status: 200 });
    }
  }

  const parsed = telegramQuickLogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const categories = await listTileCategories(prisma, userId);

  // A tile the request names is the authority on its own amount and category. Loaded rather than
  // trusted from the payload, and scoped to this user, so a stale or hostile client cannot log a
  // figure that disagrees with the button it came from -- the same rule `settleBill` applies to a
  // fixed bill, and for the same reason: the stored value is the one the user actually chose.
  const tile = input.tileId
    ? await prisma.telegramQuickTile.findFirst({
        where: { id: input.tileId, userId },
        select: { description: true, amount: true, type: true, categoryId: true },
      })
    : null;

  if (input.tileId && !tile) {
    // 404 rather than 403: confirming that somebody else's tile exists is itself an answer.
    return NextResponse.json({ error: "Tile not found" }, { status: 404 });
  }

  const type = tile ? (tile.type === "INCOME" ? "INCOME" : "EXPENSE") : input.type;
  const description = tile?.description ?? input.description;
  // A tile carrying a fixed amount ignores whatever the client sent. `null` means the tile asks,
  // so there the pad's figure is the only one there is.
  const amount = tile?.amount ?? input.amount;

  const resolved = resolveTileCategory(
    { description, type, categoryId: tile ? tile.categoryId : (input.categoryId ?? null) },
    categories
  );

  if (!resolved) {
    // `resolveTileCategory` returns null only when even an "Other" category is missing, which
    // means the defaults were never seeded. Refusing is right: the alternative is picking
    // `categories[0]`, which is how every unrecognised expense once landed under Education.
    return NextResponse.json(
      { error: "No category to file this under. Seed your categories in the app first." },
      { status: 409 }
    );
  }

  const result = await createTransactionBatch({
    prisma,
    userId,
    items: [
      {
        amount,
        description,
        type,
        // The server's clock, never the client's. A tap happens now, the webview's clock is not
        // ours, and a real timestamp is what lets the user's label schedules run against it.
        date: new Date().toISOString(),
        categoryId: resolved.categoryId,
        // `labelIds` is deliberately absent rather than `[]`. Omitting it is what lets auto-apply
        // schedules run; `[]` would be an explicit opt-out, and the distinction is load-bearing.
      },
    ],
    clientBatchId: input.clientBatchId,
    createdVia: "TELEGRAM",
    // No `mcpTokenId`: no token was involved, and a stale id is not a gap in the trail but a
    // confidently wrong answer about who wrote the row.
  });

  if (!result.ok) {
    // `UNKNOWN_WHETHER_SAVED` has to be a 5xx. The client reads a 4xx as proof nothing was
    // written and drops its idempotency pin, so a retry would write a second row.
    const status =
      result.reason === "UNKNOWN_WHETHER_SAVED" || result.reason === "NO_LONGER_PERMITTED"
        ? 500
        : 400;
    return NextResponse.json({ error: "Failed to log", reason: result.reason }, { status });
  }

  const [transaction] = result.transactions;

  // The pre-check above can miss a replay that the advisory-locked check inside
  // `createTransactionBatch` then catches, which is what a genuine double submit looks like. That
  // row was written by the other request, so this one's `resolved.via` describes a decision it
  // made and did not apply -- reported through the same shape, and equally null.
  if (result.replayed) {
    return NextResponse.json(replayResponse(transaction), { status: 200 });
  }

  return NextResponse.json(
    {
      id: transaction.id,
      amount: transaction.amount,
      description: transaction.description,
      categoryName: transaction.category.name,
      // Named on every reply, not only when it surprised us: the tile's own label is not proof of
      // where the row landed, and the confirmation is the only place the user sees the difference.
      categoryVia: resolved.via,
      labels: transaction.labels.map((l) => l.label.name),
      replayed: false,
    },
    { status: 201 }
  );
}
