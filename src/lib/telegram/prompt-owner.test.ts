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

  // A revoked token cannot write, so prompting its owner would ask for a message the bot then
  // fails to record.
  it("ignores a revoked token", async () => {
    process.env.TELEGRAM_MCP_TOKEN = "secret-token";
    const { db, findFirst } = dbReturning(null);

    expect(await telegramPromptOwnerId(db)).toBeNull();
    expect(findFirst.mock.calls[0][0].where.revokedAt).toBeNull();
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
