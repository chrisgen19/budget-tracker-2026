/**
 * An amountless quick-log button waiting for its figure, keyed by chat.
 *
 * Tapping `Grab · ₱?` on the reply keyboard cannot log anything: the button carries no amount. So
 * the bot asks, and the next message that is only a number answers it.
 *
 * Holds the tile's id, never its category or labels. Those are read again when the number arrives,
 * so an edit made on `/quick-log` in between is honoured rather than overwritten by a snapshot.
 *
 * Deliberately not persisted, the same trade `pending-scan.ts` makes: after a restart the user
 * taps the button again, which costs one tap and needs no schema.
 */
export interface PendingAmount {
  tileId: string;
  /** For the reply, so a stale prompt can still name the button it came from. */
  label: string;
  createdAt: number;
}

/**
 * Long enough to open a banking app and read a fare, short enough that a number typed much later
 * for another reason is not filed under a button the user has forgotten tapping.
 */
export const PENDING_AMOUNT_TTL_MS = 5 * 60 * 1000;

/** One per chat. A second amountless tap replaces the first, since the latest tap is the intent. */
const pending = new Map<number, PendingAmount>();

export const putPendingAmount = (chatId: number, prompt: PendingAmount): void => {
  pending.set(chatId, prompt);
};

/** Consume the prompt. Removed whether or not it is fresh, so an expired one is never picked up. */
export const takePendingAmount = (chatId: number, now = Date.now()): PendingAmount | null => {
  const prompt = pending.get(chatId);
  if (!prompt) return null;
  pending.delete(chatId);
  return now - prompt.createdAt > PENDING_AMOUNT_TTL_MS ? null : prompt;
};

/** Drop a prompt without answering it: the user moved on to something else. */
export const clearPendingAmount = (chatId: number): void => {
  pending.delete(chatId);
};
