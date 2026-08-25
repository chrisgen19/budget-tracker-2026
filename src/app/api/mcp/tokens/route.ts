import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { mcpTokenSelect, mintMcpToken } from "@/lib/mcp/tokens";
import { mcpScopeSchema } from "@/lib/mcp/scopes";

/** Longest lifetime the UI will mint. Anything longer has to be re-minted deliberately. */
const MAX_EXPIRY_DAYS = 365;

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(mcpScopeSchema).min(1),
  /** `null` mints a token that never expires — allowed, but never the default. */
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).nullable(),
});

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const tokens = await prisma.mcpToken.findMany({
    where: { userId },
    select: mcpTokenSelect,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tokens });
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const parsed = createTokenSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { token, record } = await mintMcpToken({ userId, ...parsed.data });

  // The only time the plaintext is ever returned. It is not stored, so a user who loses it
  // mints a new one rather than recovering this.
  return NextResponse.json({ token, record }, { status: 201 });
}
