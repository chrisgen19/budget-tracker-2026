import { afterEach, describe, expect, it, vi } from "vitest";
import { hashMcpToken } from "@/lib/mcp/tokens";
import { telegramPromptOwnerId, type PromptOwnerDb } from "@/lib/telegram/prompt-owner";

const ORIGINAL = process.env.TELEGRAM_MCP_TOKEN;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TELEGRAM_MCP_TOKEN;
  else process.env.TELEGRAM_MCP_TOKEN = ORIGINAL;
});

const dbReturning = (row: { userId: string } | null) => {
  const findFirst = vi.fn().mockResolvedValue(row);
  return { db: { mcpToken: { findFirst } } as unknown as PromptOwnerDb, findFirst };
};

describe("telegramPromptOwnerId", () => {
  it("resolves the account the bot writes into", async () => {
    process.env.TELEGRAM_MCP_TOKEN = "secret-token";
    const { db, findFirst } = dbReturning({ userId: "u1" });

    expect(await telegramPromptOwnerId(db)).toBe("u1");
    // Looked up by digest, never by the token itself: only the hash is stored.
    expect(findFirst.mock.calls[0][0].where.tokenHash).toBe(hashMcpToken("secret-token"));
  });

  // A revoked or expired token cannot write, so prompting its owner asks for a message the bot
  // then fails to record: the prompt keeps arriving, every reply fails, and nothing says why.
  it("ignores a revoked token", async () => {
    process.env.TELEGRAM_MCP_TOKEN = "secret-token";
    const { db, findFirst } = dbReturning(null);

    expect(await telegramPromptOwnerId(db)).toBeNull();
    expect(findFirst.mock.calls[0][0].where.revokedAt).toBeNull();
  });

  // Not a remote possibility: the bot's token needs `transactions:write`, and such a token may
  // not choose "Never" and is capped at MAX_WRITE_TOKEN_EXPIRY_DAYS, so it is certain to lapse.
  // `authenticateMcpRequest` then rejects every write as EXPIRED while the prompt kept arriving.
  it("excludes an expired token from the lookup", async () => {
    process.env.TELEGRAM_MCP_TOKEN = "secret-token";
    const { db, findFirst } = dbReturning(null);
    const now = new Date("2026-09-01T12:00:00.000Z");

    await telegramPromptOwnerId(db, now);

    const where = findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: now } }]);
  });

  // Null expiry is legal and means "never expires", which a read-only token may be minted with.
  it("still accepts a token that never expires", async () => {
    process.env.TELEGRAM_MCP_TOKEN = "secret-token";
    const { db, findFirst } = dbReturning({ userId: "u1" });

    expect(await telegramPromptOwnerId(db)).toBe("u1");
    expect(findFirst.mock.calls[0][0].where.OR).toContainEqual({ expiresAt: null });
  });

  it("returns null with no token, without touching the database", async () => {
    delete process.env.TELEGRAM_MCP_TOKEN;
    const { db, findFirst } = dbReturning({ userId: "u1" });

    expect(await telegramPromptOwnerId(db)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  // Blank counts as unset for every TELEGRAM_ variable, which is what `env` exists to enforce.
  it("treats a blank token as absent", async () => {
    process.env.TELEGRAM_MCP_TOKEN = "   ";
    const { db, findFirst } = dbReturning({ userId: "u1" });

    expect(await telegramPromptOwnerId(db)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns null when the token matches no row", async () => {
    process.env.TELEGRAM_MCP_TOKEN = "stale-token";
    const { db } = dbReturning(null);
    expect(await telegramPromptOwnerId(db)).toBeNull();
  });
});
