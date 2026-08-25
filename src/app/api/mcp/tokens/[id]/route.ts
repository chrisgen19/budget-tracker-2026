import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { mcpTokenSelect } from "@/lib/mcp/tokens";

/**
 * Revoke a token.
 *
 * Marks it revoked rather than deleting it, so the row still answers "what was this credential
 * allowed to do, and when was it last used" after the fact: the questions that actually matter
 * once you suspect a token leaked.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  // Scoped by userId as well as id, so one user cannot revoke another's token by guessing a cuid.
  const existing = await prisma.mcpToken.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
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
