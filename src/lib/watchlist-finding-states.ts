import { createHash } from "node:crypto";
import type { PrismaClient, WatchlistFindingStatus } from "@prisma/client";

export type SuppressingWatchlistState = WatchlistFindingStatus;

/** Store only a one-way digest of a key; keys may contain user-entered text. */
export const hashWatchlistFindingKey = (key: string): string =>
  createHash("sha256").update(key).digest("hex");

/** Return only live suppressions for the findings currently on screen. */
export const getSuppressingWatchlistStates = async (
  prisma: PrismaClient,
  userId: string,
  findingKeys: string[],
  now = new Date(),
): Promise<Record<string, SuppressingWatchlistState>> => {
  const uniqueKeys = [...new Set(findingKeys)];
  if (uniqueKeys.length === 0) return {};
  const keysByHash = new Map(uniqueKeys.map((key) => [hashWatchlistFindingKey(key), key]));
  const rows = await prisma.watchlistFindingState.findMany({
    where: { userId, findingHash: { in: [...keysByHash.keys()] } },
    select: { findingHash: true, status: true, snoozedUntil: true },
  });

  return Object.fromEntries(rows.flatMap((row) => {
    const key = keysByHash.get(row.findingHash);
    if (!key || (row.status === "SNOOZED" && (!row.snoozedUntil || row.snoozedUntil <= now))) return [];
    return [[key, row.status] as const];
  }));
};
