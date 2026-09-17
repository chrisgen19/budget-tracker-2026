import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getSuppressingWatchlistStates,
  hashWatchlistFindingKey,
} from "@/lib/watchlist-finding-states";

const client = (rows: unknown[]) => ({
  watchlistFindingState: { findMany: vi.fn().mockResolvedValue(rows) },
}) as unknown as PrismaClient;

describe("getSuppressingWatchlistStates", () => {
  it("returns resolved and still-snoozed findings, but lets an expired snooze return", async () => {
    const active = "watchlist:v1:period:duplicate:active";
    const snoozed = "watchlist:v1:period:pace:snoozed";
    const expired = "watchlist:v1:outstanding:missed-bill:expired";
    const now = new Date("2026-09-17T00:00:00.000Z");
    const prisma = client([
      { findingHash: hashWatchlistFindingKey(active), status: "RESOLVED", snoozedUntil: null },
      { findingHash: hashWatchlistFindingKey(snoozed), status: "SNOOZED", snoozedUntil: new Date("2026-09-18T00:00:00.000Z") },
      { findingHash: hashWatchlistFindingKey(expired), status: "SNOOZED", snoozedUntil: new Date("2026-09-16T00:00:00.000Z") },
    ]);

    await expect(getSuppressingWatchlistStates(prisma, "user-1", [active, snoozed, expired], now)).resolves.toEqual({
      [active]: "RESOLVED",
      [snoozed]: "SNOOZED",
    });
  });
});
