/**
 * The payload behind a receipt review's buttons.
 *
 * It carries the *photo's* update id, and that is the whole point rather than a detail. Buttons
 * never expire from Telegram's chat history: a review from an hour ago is still tappable. Without
 * an identity in the payload, scrolling up and tapping an old "Save" would confirm whichever scan
 * happens to be pending now — showing the user one amount and saving another, which is the same
 * failure the frozen-draft rule exists to prevent.
 *
 * `callback_data` is capped at 64 bytes by Telegram, so the encoding is terse.
 */
export type ScanAction = "save" | "discard";

export interface ScanCallback {
  action: ScanAction;
  /** The update the photo arrived on — matches `PendingScan.updateId`. */
  updateId: number;
}

const PREFIX = "rs";
const CODES: Record<string, ScanAction> = { y: "save", n: "discard" };
const LETTERS: Record<ScanAction, string> = { save: "y", discard: "n" };

export const encodeScanCallback = ({ action, updateId }: ScanCallback): string =>
  `${PREFIX}:${LETTERS[action]}:${updateId}`;

/** Parses a payload, or null for anything this bot did not author. */
export const parseScanCallback = (data: unknown): ScanCallback | null => {
  if (typeof data !== "string") return null;

  const [prefix, letter, rawId] = data.split(":");
  if (prefix !== PREFIX) return null;

  const action = CODES[letter];
  if (!action) return null;

  // Matched as text first: Number("") is 0, a perfectly valid-looking update id that belongs to
  // no scan, and `updateId` is always a positive integer.
  if (!/^[1-9]\d*$/.test(rawId ?? "")) return null;

  const updateId = Number(rawId);
  return Number.isSafeInteger(updateId) ? { action, updateId } : null;
};
