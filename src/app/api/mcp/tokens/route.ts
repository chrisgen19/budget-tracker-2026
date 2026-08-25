import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { mcpTokenSelect, mintMcpToken } from "@/lib/mcp/tokens";
import { createMcpTokenSchema } from "@/lib/validations";

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

  let json: unknown;
  try {
    json = await request.json();
  } catch (error) {
    console.error("[mcp/tokens] invalid JSON body:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = createMcpTokenSchema.safeParse(json);
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
