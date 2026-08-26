/** One size of a photo Telegram has already transcoded. */
export interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}

/** The fields of a Telegram message this bot actually reads. */
export interface TelegramMessage {
  chat: { id: number; type?: string };
  from?: { id?: number; username?: string };
  text?: string;
  /** Ascending by size. Telegram recompresses these, so the largest is the best available. */
  photo?: TelegramPhotoSize[];
  /** A file sent without compression, which is the better source for OCR when the user picks it. */
  document?: { file_id: string; mime_type?: string; file_size?: number };
  /** Present on both photos and documents when the user typed a message with the attachment. */
  caption?: string;
}

export interface Allowlist {
  ids: ReadonlySet<string>;
  usernames: ReadonlySet<string>;
}

/**
 * Whether this bot may answer a message.
 *
 * Two independent conditions, and both must hold.
 *
 * The sender must be on the allowlist. IDs are preferred; usernames are accepted for convenience
 * but are weaker, because a released @handle can be claimed by someone else, who would then
 * inherit access. An empty allowlist denies everyone: failing closed matters more than failing
 * usefully here.
 *
 * The chat must be private. Authenticating only the sender was not enough: replies go to
 * `message.chat.id`, so the owner running /summary in a group would have shown their balances
 * and recent spending to everyone in it. Nothing this bot answers is meant for an audience, so
 * there is no group case to support.
 */
export const messageIsAllowed = (
  message: TelegramMessage | undefined,
  { ids, usernames }: Allowlist
): boolean => {
  if (!message) return false;

  // Absent rather than "private" is treated as not private. Telegram always sets it; a payload
  // that does not is one this bot does not understand, and guessing in the permissive direction
  // is the wrong way to be wrong about where a reply lands.
  if (message.chat?.type !== "private") return false;

  const from = message.from;
  if (!from) return false;
  if (from.id !== undefined && ids.has(String(from.id))) return true;
  return from.username !== undefined && usernames.has(from.username.toLowerCase());
};
