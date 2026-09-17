// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashWatchlistFindingKey } from "@/lib/watchlist-finding-states";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/prisma", () => ({
  prisma: { watchlistFindingState: { upsert: mocks.upsert } },
}));

import { PATCH } from "@/app/api/watchlist/findings/route";

const key = "watchlist:v1:period:duplicate:test";

describe("PATCH /api/watchlist/findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.upsert.mockResolvedValue({});
  });

  it("stores a resolved decision against a hash rather than the raw finding key", async () => {
    const response = await PATCH(new Request("http://localhost/api/watchlist/findings", {
      method: "PATCH",
      body: JSON.stringify({ findingKey: key, action: "RESOLVED" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_findingHash: { userId: "user-1", findingHash: hashWatchlistFindingKey(key) } },
      create: expect.objectContaining({
        findingHash: hashWatchlistFindingKey(key),
        status: "RESOLVED",
        snoozedUntil: null,
      }),
    }));
    expect(JSON.stringify(mocks.upsert.mock.calls)).not.toContain(key);
  });

  it("rejects malformed action payloads before writing", async () => {
    const response = await PATCH(new Request("http://localhost/api/watchlist/findings", {
      method: "PATCH",
      body: JSON.stringify({ findingKey: "not-a-watchlist-key", action: "SNOOZED" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
