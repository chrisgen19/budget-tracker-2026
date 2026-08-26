import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { mcpTokenSelect } from "@/lib/mcp/tokens";

/**
 * Revoke a token, or delete an already-revoked one for good.
 *
 * Revoking marks the row rather than removing it, so it still answers "what was this credential
 * allowed to do, and when was it last used" after the fact: the questions that actually matter
 * once you suspect a token leaked.
 *
 * `?permanent=true` removes the row. It is refused on a live token, which makes deletion a
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
    select: { id: true, revokedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  if (permanent) {
    if (!existing.revokedAt) {
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
