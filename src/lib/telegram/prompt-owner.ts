/**
 * Which app user the Telegram prompt belongs to.
 *
 * The bot serves exactly one budget: `TELEGRAM_MCP_TOKEN` is minted by a person, and every row
 * the bot writes lands in that person's account. So the evening prompt belongs to whoever owns
 * that token, and to nobody else.
 *
 * Deriving it rather than adding a `TELEGRAM_PROMPT_USER_ID` variable keeps it from drifting:
 * there is no second value to update when the token is re-minted, and no way to point the prompt
 * at one account while the bot writes to another. Rotating the token is safe, since the lookup
 * hashes whatever the environment currently holds.
 *
 * Without this the feature is a foot-gun on a multi-user deployment: the toggle would appear for
 * everyone, and a second person switching it on would have their day read and someone else's
 * chat messaged about it.
 */
import { hashMcpToken } from "@/lib/mcp/tokens";
import { env } from "@/lib/telegram/env";

/** Just the part of Prisma this needs, so callers can inject a client or a stub. */
export interface PromptOwnerDb {
  mcpToken: {
    findFirst: (args: {
      where: {
        tokenHash: string;
        revokedAt: null;
        OR: ({ expiresAt: null } | { expiresAt: { gt: Date } })[];
      };
      select: { userId: true };
    }) => Promise<{ userId: string } | null>;
  };
}

/**
 * The user who owns the bot's MCP token, or null when there is no *usable* one.
 *
 * Usable is the operative word, and it is why this matches `authenticateMcpRequest`'s own
 * conditions rather than merely finding the row. A revoked or expired token cannot write, so
 * prompting its owner asks them for a message the bot then fails to record - the prompt keeps
 * arriving, every reply fails, and nothing in the chat explains why.
 *
 * Expiry is not a remote possibility here. The bot's token needs `transactions:write`, and such a
 * token may not choose "Never" and is capped at `MAX_WRITE_TOKEN_EXPIRY_DAYS`, so it is certain to
 * lapse. Silence is the right behaviour then: it is also the signal that the token needs re-minting.
 */
export const telegramPromptOwnerId = async (
  db: PromptOwnerDb,
  now: Date = new Date()
): Promise<string | null> => {
  const token = env("TELEGRAM_MCP_TOKEN");
  if (!token) return null;

  const row = await db.mcpToken.findFirst({
    where: {
      tokenHash: hashMcpToken(token),
      revokedAt: null,
      // Null means it never expires, which is legal for a read-only token.
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { userId: true },
  });

  return row?.userId ?? null;
};
