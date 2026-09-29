import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mcpToken: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { PATCH } from "@/app/api/mcp/tokens/[id]/route";

const context = { params: Promise.resolve({ id: "tok-1" }) };
const DAY_MS = 24 * 60 * 60 * 1000;

const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/mcp/tokens/tok-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    context
  );

/** The bot's real token: every scope its handlers need, `transactions:write` included. */
const telegramToken = {
  scopes: ["budget:read", "transactions:read", "transactions:write"],
  source: "TELEGRAM",
  revokedAt: null,
  expiresAt: new Date(Date.now() + 30 * DAY_MS),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUserId.mockResolvedValue("user-1");
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findUnique.mockResolvedValue({ id: "tok-1", expiresAt: null });
});

describe("PATCH /api/mcp/tokens/[id]", () => {
  // The whole point: the bot's token stops lapsing without a new secret or a Coolify edit.
  it("lets the Telegram bot's write token be set to never expire, in place", async () => {
    mocks.findFirst.mockResolvedValue(telegramToken);

    const response = await patch({ expiresInDays: null });

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "tok-1", userId: "user-1", revokedAt: null }),
        data: { expiresAt: null },
      })
    );
  });

  it("counts a new lifetime from now, replacing the old expiry", async () => {
    mocks.findFirst.mockResolvedValue(telegramToken);
    const before = Date.now();

    await patch({ expiresInDays: 365 });

    const { expiresAt } = mocks.updateMany.mock.calls[0][0].data;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 365 * DAY_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 365 * DAY_MS);
  });

  // Laptop tokens keep the cap: the exemption is the bot's alone.
  it("still refuses Never for an assistant's write token", async () => {
    mocks.findFirst.mockResolvedValue({ ...telegramToken, source: "MCP" });

    const response = await patch({ expiresInDays: null });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A token with a write scope must expire",
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("still caps an assistant's write token at 90 days", async () => {
    mocks.findFirst.mockResolvedValue({ ...telegramToken, source: "MCP" });

    expect((await patch({ expiresInDays: 365 })).status).toBe(400);
    expect((await patch({ expiresInDays: 90 })).status).toBe(200);
  });

  // Expiry and revocation are how a leaked credential stops working; this must not undo them.
  it("refuses to revive a revoked or expired token", async () => {
    mocks.findFirst.mockResolvedValue({ ...telegramToken, revokedAt: new Date() });
    expect((await patch({ expiresInDays: null })).status).toBe(409);

    mocks.findFirst.mockResolvedValue({ ...telegramToken, expiresAt: new Date(Date.now() - 1000) });
    expect((await patch({ expiresInDays: null })).status).toBe(409);

    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("reports a revoke that lands between the read and the write as dead, not saved", async () => {
    mocks.findFirst.mockResolvedValue(telegramToken);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    expect((await patch({ expiresInDays: null })).status).toBe(409);
  });

  it("answers another user's token as not found", async () => {
    mocks.findFirst.mockResolvedValue(null);

    expect((await patch({ expiresInDays: 30 })).status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tok-1", userId: "user-1" } })
    );
  });

  it("refuses a malformed lifetime before reading anything", async () => {
    for (const expiresInDays of [0, 366, 1.5, "90"]) {
      expect((await patch({ expiresInDays })).status).toBe(400);
    }
    expect((await patch({})).status).toBe(400);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
