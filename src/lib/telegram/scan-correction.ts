import { isConfirmation, isRejection } from "@/lib/telegram/pending-scan";
import { resolveCommand } from "@/lib/telegram/commands";

/**
 * Whether a reply, sent while a scan is waiting, is meant to correct its description.
 *
 * The review shows what the OCR read and asks for yes or no. Anything else used to fall through
 * to normal handling and be classified as an unrelated message, so a user answering "groceries at
 * SM" — the most natural way to fix a wrong description — was silently ignored while the scan sat
 * there until its TTL. The correction went nowhere and nothing said so.
 *
 * The fall-through itself was deliberate and is preserved: the comment on it reads "typing another
 * expense logs it rather than being refused", and that stays true. So this is defined by
 * *exclusion* rather than by trying to recognise a description, which is not a recognisable shape:
 * a reply is a correction only when it is not already something the bot does.
 *
 * The asymmetry that ruled out using a photo's caption as a description directly does not apply
 * here. A caption arrives unbidden and is often not a description at all — "here you go" is an
 * ordinary thing to send with a photo. A reply to an explicit invitation is unambiguous.
 */

/** Long enough for "groceries and cleaning stuff at SM", short enough that a pasted paragraph is
 *  not mistaken for one. Descriptions are capped at 255 by the write schema regardless. */
export const MAX_CORRECTION_CHARS = 120;

/** Starts with an amount, so the shorthand logger owns it: "100 breakfast", "+5000 salary". */
const LOOKS_LIKE_AN_AMOUNT = /^\+?\d/;

export const isScanCorrection = (text: string): boolean => {
  const trimmed = text.trim();

  if (!trimmed || trimmed.length > MAX_CORRECTION_CHARS) return false;
  // Answering the question, not correcting it.
  if (isConfirmation(trimmed) || isRejection(trimmed)) return false;
  // A new expense or income still logs, exactly as before.
  if (LOOKS_LIKE_AN_AMOUNT.test(trimmed)) return false;
  // "/summary", "bills please" and friends keep working mid-review.
  if (resolveCommand(trimmed)) return false;
  // A slash command this bot does not handle is still not a description.
  if (trimmed.startsWith("/")) return false;

  return true;
};

/** The description to store, trimmed and bounded. Capitalised the same way the shorthand logger
 *  capitalises what the user typed, so a correction reads like the rest of their entries. */
export const correctedDescription = (text: string): string => {
  const trimmed = text.trim().slice(0, MAX_CORRECTION_CHARS);
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};
