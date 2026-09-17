import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { watchlistFindingActionSchema } from "@/lib/validations";
import { hashWatchlistFindingKey } from "@/lib/watchlist-finding-states";

const SNOOZE_DAYS = 7;

/** Persist a resolve or seven-day snooze decision for a live Watchlist finding. */
export async function PATCH(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = watchlistFindingActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid Watchlist action" }, { status: 400 });

  const now = new Date();
  const isSnooze = parsed.data.action === "SNOOZED";
  const findingHash = hashWatchlistFindingKey(parsed.data.findingKey);
  const snoozedUntil = isSnooze
    ? new Date(now.getTime() + SNOOZE_DAYS * 86_400_000)
    : null;

  try {
    await prisma.watchlistFindingState.upsert({
      where: {
        userId_findingHash: {
          userId,
          findingHash,
        },
      },
      create: {
        userId,
        findingHash,
        status: parsed.data.action,
        snoozedUntil,
        resolvedAt: isSnooze ? null : now,
      },
      update: {
        status: parsed.data.action,
        snoozedUntil,
        resolvedAt: isSnooze ? null : now,
      },
    });
    return NextResponse.json({ status: parsed.data.action, snoozedUntil });
  } catch (error) {
    console.error("[watchlist/findings] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to save Watchlist action" }, { status: 500 });
  }
}
