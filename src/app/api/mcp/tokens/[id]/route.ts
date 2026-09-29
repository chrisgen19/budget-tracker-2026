import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { expiryFromDays, mcpTokenSelect } from "@/lib/mcp/tokens";
import { isTokenDead } from "@/lib/mcp/token-status";
import { parseScopes } from "@/lib/mcp/scopes";
import { tokenExpiryRefusal, updateMcpTokenExpirySchema } from "@/lib/validations";

const TOKEN_DEAD = "This token no longer works. Create a new one instead.";

/**
 * Change a live token's expiry, counted from now and replacing the old one.
 *
 * Exists so the Telegram bot's token can be given a longer life **in place**: re-minting means a
 * new secret, pasting it into Coolify and a redeploy, and every step is a chance to break the bot.
 * The same `tokenExpiryRefusal` as minting judges it, against the token's stored scopes and
 * source, so nothing can be made to outlive what it could have been minted with.
 *
 * A dead token is refused rather than revived. Expiry and revocation are how a credential that
 * may have leaked stops working, and bringing one back is exactly what they exist to prevent.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const parsed = updateMcpTokenExpirySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid expiry" }, { status: 400 });
  }

  const existing = await prisma.mcpToken.findFirst({
    where: { id, userId },
    select: { scopes: true, source: true, revokedAt: true, expiresAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }
  if (isTokenDead(existing)) return NextResponse.json({ error: TOKEN_DEAD }, { status: 409 });

  const { expiresInDays } = parsed.data;
  // `APP` is never minted, so a stored source outside the schema is treated as the strict case.
  const source = existing.source === "TELEGRAM" ? "TELEGRAM" : "MCP";
  const scopes = parseScopes(existing.scopes);
  const refusal = tokenExpiryRefusal({ scopes, source, expiresInDays });
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });

  // Guarded on the same conditions as the check above, so a revoke or lapse that lands between
  // the read and this write is not undone by it.
  const { count } = await prisma.mcpToken.updateMany({
    where: {
      id,
      userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    data: { expiresAt: expiryFromDays(expiresInDays) },
  });
  if (count === 0) return NextResponse.json({ error: TOKEN_DEAD }, { status: 409 });

  const record = await prisma.mcpToken.findUnique({ where: { id }, select: mcpTokenSelect });
  return NextResponse.json({ record });
}

/**
 * Revoke a token, or delete an already-revoked one for good.
 *
 * Revoking marks the row rather than removing it, so it still answers "what was this credential
 * allowed to do, and when was it last used" after the fact: the questions that actually matter
 * once you suspect a token leaked.
 *
 * `?permanent=true` removes the row. It is refused on a token that still works, which makes
 * deletion a
 * deliberate two-step rather than something one misclick can do to a working credential, and
 * leaves the revocation as the fast path when a token has actually leaked. Transactions the
 * token wrote are untouched: `transactions.mcp_token_id` is deliberately not a foreign key, so
 * nothing cascades and the rows keep their provenance. What is lost is the ability to resolve
 * that id back to a name, which is why the UI says so before asking.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const permanent = new URL(request.url).searchParams.get("permanent") === "true";

  // Scoped by userId as well as id, so one user cannot revoke another's token by guessing a cuid.
  const existing = await prisma.mcpToken.findFirst({
    where: { id, userId },
    select: { id: true, revokedAt: true, expiresAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  if (permanent) {
    // Expiry counts as well as revocation. Both mean the credential no longer works, which is
    // the only thing this guard is protecting against, and the list offers Delete on either. A
    // check for `revoked_at` alone stranded expired tokens: no Revoke button, and a 409 here.
    if (!isTokenDead(existing)) {
      return NextResponse.json(
        { error: "Revoke this token before deleting it." },
        { status: 409 }
      );
    }

    // Scoped by userId here too: the lookup above already proved ownership, but a delete is worth
    // narrowing at the point it happens rather than relying on a check further up.
    await prisma.mcpToken.deleteMany({ where: { id, userId } });
    return NextResponse.json({ deleted: true });
  }

  // Idempotent: revoking an already-revoked token succeeds. Two tabs listing the same live token
  // is ordinary, and reporting "failed to revoke" for a credential that is in fact revoked tells
  // the user the opposite of the truth at the moment they least want to be misled. `revokedAt:
  // null` stays in the *write* filter so a repeat keeps the original revocation's timestamp.
  await prisma.mcpToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const record = await prisma.mcpToken.findUnique({ where: { id }, select: mcpTokenSelect });
  return NextResponse.json({ record });
}
