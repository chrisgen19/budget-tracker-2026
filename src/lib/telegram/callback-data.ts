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

/**
 * The payload behind the evening prompt's "Nothing today" button.
 *
 * It carries the local calendar day the prompt was sent for, for the same reason the scan
 * callback carries an update id: buttons never expire from chat history, so last Tuesday's
 * prompt is still tappable and must not be able to answer for today. Nothing is written either
 * way - the button only acknowledges - but reporting "nothing logged for today" when the tap
 * meant a week ago is a lie the user has no way to catch.
 */
const PROMPT_PREFIX = "dp";

export interface PromptCallback {
  /** The user's local day, "YYYY-MM-DD". */
  day: string;
}

export const encodePromptCallback = ({ day }: PromptCallback): string =>
  `${PROMPT_PREFIX}:x:${day}`;

/** Parses a payload, or null for anything this bot did not author. */
export const parsePromptCallback = (data: unknown): PromptCallback | null => {
  if (typeof data !== "string") return null;

  const [prefix, letter, day] = data.split(":");
  if (prefix !== PROMPT_PREFIX || letter !== "x") return null;

  // Shape only. A day that does not exist is still refused downstream by not matching the
  // prompt that was actually sent, and validating the calendar here would duplicate that.
  return /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? { day } : null;
};
