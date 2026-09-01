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
      where: { tokenHash: string; revokedAt: null };
      select: { userId: true };
    }) => Promise<{ userId: string } | null>;
  };
}

/**
 * The user who owns the bot's MCP token, or null when there is no usable one.
 *
 * A revoked token counts as none: the bot cannot write with it, so prompting its owner to log
 * something would be asking for a message the bot then fails to record.
 */
export const telegramPromptOwnerId = async (db: PromptOwnerDb): Promise<string | null> => {
  const token = env("TELEGRAM_MCP_TOKEN");
  if (!token) return null;

  const row = await db.mcpToken.findFirst({
    where: { tokenHash: hashMcpToken(token), revokedAt: null },
    select: { userId: true },
  });

  return row?.userId ?? null;
};
