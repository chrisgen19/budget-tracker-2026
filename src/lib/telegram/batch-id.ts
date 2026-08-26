import { createHash } from "node:crypto";

/**
 * A stable idempotency key for one Telegram update.
 *
 * `create_transactions` validates `clientBatchId` as a UUID, so the obvious `telegram-<id>` was
 * rejected before anything was written and every logging message failed. The key still has to be
 * derived rather than random: the poller advances its offset before handling a message and keeps
 * it only in memory, so a crash mid-write makes Telegram redeliver that update on restart. A
 * random key would write the transaction twice; this one replays and returns the original row.
 *
 * Derived from a digest rather than `randomUUID`, and seeded with the bot id so a future bot
 * token, whose update ids start over, cannot collide with keys already stored against this one.
 * Shaped as a v4 UUID because that is what the schema checks; it is deterministic, not random.
 *
 * @param botId The numeric half of the bot token, which identifies the bot and is not its secret.
 * @param updateId Telegram's `update_id`, unique and stable per bot.
 */
export const updateBatchId = (botId: string, updateId: number): string => {
  const hex = createHash("sha256").update(`telegram:${botId}:${updateId}`).digest("hex");
  const version = `4${hex.slice(13, 16)}`;
  // The variant nibble must be one of 8, 9, a, b.
  const variant = `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`;
};
