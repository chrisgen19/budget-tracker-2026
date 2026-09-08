/**
 * The numeric pad's keystroke rules, kept separate from the component that draws it.
 *
 * A custom keypad rather than `<input type="number">`, and that is a deliberate trade rather than
 * a stylistic one. No OS keyboard means the viewport never resizes mid-entry, which removes the
 * whole class of layout problems `modal.tsx` solves for iOS Safari. It also means three taps
 * instead of a keyboard animation, on a screen whose entire premise is being faster than typing.
 *
 * Pure string transitions, so every rule below is testable without rendering anything.
 */

/** Two decimals, matching what the app stores and what the server rounds to. */
const MAX_DECIMALS = 2;

/**
 * A ceiling on the digits before the point.
 *
 * Not a validation rule -- the server owns that -- but a guard against a stuck key or a pocket
 * tap producing a figure nobody can read back. Seven digits is ten million, comfortably past any
 * fare or lunch this grid is for.
 */
const MAX_INTEGER_DIGITS = 7;

export type PadKey = string | "." | "back" | "clear";

/**
 * Apply one keypress to the current entry.
 *
 * The entry is held as the *string* the user typed, not a number, because `"0."` and `"38.0"` are
 * states a number cannot represent and the display has to show them while they are being typed.
 */
export const pressKey = (current: string, key: PadKey): string => {
  if (key === "clear") return "";
  if (key === "back") return current.slice(0, -1);

  if (key === ".") {
    // A leading point is written as "0." so the display never starts with a bare separator.
    if (current === "") return "0.";
    // One point only. A second press is ignored rather than replacing the first, which would move
    // the decimal under the user's fingers.
    return current.includes(".") ? current : `${current}.`;
  }

  if (!/^[0-9]$/.test(key)) return current;

  // A leading zero is replaced rather than accumulated, so "0" then "5" is 5 and not "05".
  if (current === "0") return key;

  const [whole, fraction] = current.split(".");
  if (fraction !== undefined) {
    if (fraction.length >= MAX_DECIMALS) return current;
  } else if (whole.length >= MAX_INTEGER_DIGITS) {
    return current;
  }

  return current + key;
};

/**
 * The amount to submit, or null when the entry is not yet a usable figure.
 *
 * Null covers empty, a bare "0.", and zero itself. Zero is deliberately not submittable: the
 * server refuses it, and a zero-amount transaction is a real thing to write by accident that
 * nothing downstream would flag.
 */
export const padAmount = (current: string): number | null => {
  if (current === "" || current === "0.") return null;

  const value = Number(current);
  if (!Number.isFinite(value) || value <= 0) return null;

  // Rounded here as well as server-side, so what the button says is what gets written.
  return Math.round(value * 100) / 100;
};

/** What the pad shows, keeping a trailing point visible while it is being typed. */
export const padDisplay = (current: string): string => (current === "" ? "0" : current);
