/** A scan waiting for the user to confirm it, keyed by chat. */
export interface PendingScan {
  amount: number;
  description: string;
  categoryId: string;
  categoryName: string;
  date: string;
  /** The update the photo arrived on. The idempotency key derives from this rather than from the
   *  confirming message, so a redelivered "yes" replays instead of writing a second row. */
  updateId: number;
  /**
   * The review message carrying the Save/Discard buttons.
   *
   * Held so a *typed* yes or no can take the buttons off too. Without it the keyboard stayed
   * visibly active after the review had already been answered by typing, and tapping it later
   * reported the receipt as expired or stale — true of the draft, misleading about the receipt,
   * which had in fact been saved.
   */
  reviewMessageId?: number;
  createdAt: number;
  /**
   * Set when a save failed without settling, so nobody knows whether the row exists.
   *
   * A retry replays the same `updateId` key. If the first write did commit, the server returns the
   * *original* row and any edit made in between is silently discarded — the user would be shown a
   * corrected description and saved the old one. So an unsettled draft is frozen: it can still be
   * confirmed, which is what resolves the ambiguity, but not edited.
   *
   * The web app's multi-scan review has the same rule for the same reason ("Unacknowledged saves"
   * in AGENTS.md): rows pinned by an unknown outcome are frozen, and the UI does not offer editing.
   * A deterministic refusal is different — nothing was written, so the draft stays editable.
   */
  frozen?: boolean;
}

/**
 * Scans awaiting confirmation, in memory, one per chat.
 *
 * Deliberately not persisted. A pending scan is worth nothing after a restart: the user gets no
 * confirmation, sends the photo again, and pays one more scan. Persisting it would mean a schema
 * change and a second write path for something whose whole lifetime is a few seconds of
 * conversation.
 *
 * One per chat, so a second photo replaces the first rather than queueing. "Yes" is ambiguous
 * otherwise, and the wrong receipt being saved is worse than being asked to resend.
 */
const pending = new Map<number, PendingScan>();

/** Long enough to walk away and come back, short enough that a stale "yes" cannot save something
 *  the user has forgotten about. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

export const putPendingScan = (chatId: number, scan: PendingScan): void => {
  pending.set(chatId, scan);
};

export const takePendingScan = (chatId: number, now = Date.now()): PendingScan | null => {
  const scan = pending.get(chatId);
  if (!scan) return null;

  // Removed whether or not it is still fresh: an expired one is never valid again, and leaving it
  // would let a later "yes" pick it up.
  pending.delete(chatId);
  return now - scan.createdAt > PENDING_TTL_MS ? null : scan;
};

/** Whether a scan is waiting, without consuming it. Used to tell the user their earlier receipt
 *  survived when a replacement scan fails. */
export const hasPendingScan = (chatId: number, now = Date.now()): boolean => {
  const scan = pending.get(chatId);
  return !!scan && now - scan.createdAt <= PENDING_TTL_MS;
};

/**
 * Replace a waiting scan's description, without consuming it.
 *
 * The timestamp is refreshed because a correction is the user actively engaged with the review,
 * and the TTL exists to stop a *forgotten* scan being saved by a stale "yes" — the same reasoning
 * `confirmPendingScan` uses when it restores a scan after a failed save.
 *
 * `updateId` is deliberately untouched: the idempotency key derives from the photo's update, so a
 * corrected scan still replays rather than writing a second row.
 */
export type ReviseResult =
  | { status: "revised"; scan: PendingScan }
  /** Waiting, but pinned by an unsettled write: a replay would discard the edit. */
  | { status: "frozen" }
  | { status: "none" };

export const revisePendingScan = (
  chatId: number,
  description: string,
  now = Date.now()
): ReviseResult => {
  const scan = pending.get(chatId);
  if (!scan || now - scan.createdAt > PENDING_TTL_MS) return { status: "none" };
  if (scan.frozen) return { status: "frozen" };

  const revised = { ...scan, description, createdAt: now };
  pending.set(chatId, revised);
  return { status: "revised", scan: revised };
};

/** The waiting scan itself, without consuming it. A button press has to check which scan it
 *  belongs to *before* deciding to act on it. */
export const peekPendingScan = (chatId: number, now = Date.now()): PendingScan | null => {
  const scan = pending.get(chatId);
  return scan && now - scan.createdAt <= PENDING_TTL_MS ? scan : null;
};

export const clearPendingScan = (chatId: number): void => {
  pending.delete(chatId);
};

/** Whether a reply means "save it". Kept narrow: anything else falls through to normal handling,
 *  so a user who types another expense instead of answering gets that logged rather than a
 *  confusing refusal. */
export const isConfirmation = (text: string): boolean =>
  /^(y|ye|yes|yep|yup|ok|okay|sure|save|confirm|go|👍|✅)$/i.test(text.trim());

export const isRejection = (text: string): boolean =>
  /^(n|no|nope|cancel|discard|nah|❌)$/i.test(text.trim());
