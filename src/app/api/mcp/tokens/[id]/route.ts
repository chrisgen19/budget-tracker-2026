import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { mcpTokenSelect } from "@/lib/mcp/tokens";

/**
 * Revoke a token.
 *
 * Marks it revoked rather than deleting it, so the row still answers "what was this credential
 * allowed to do, and when was it last used" after the fact — the questions that actually matter
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
  const { count } = await prisma.mcpToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (count === 0) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 });
  }

  const record = await prisma.mcpToken.findUnique({ where: { id }, select: mcpTokenSelect });
  return NextResponse.json({ record });
}
