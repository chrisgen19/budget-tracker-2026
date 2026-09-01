/**
 * The buttons pinned above the message box, for the fares paid every workday.
 *
 * The trick this rests on: a `ReplyKeyboardMarkup` button **sends its own label as an ordinary
 * message**. So a button reading `38 fare to office` sends exactly that text, which the shorthand
 * path already parses, categorises and logs. No new write path, no callback, no state. The button
 * is the message.
 *
 * That is also the constraint. Every label here has to be valid shorthand — an amount, then a
 * description — and has to resolve to the category the user expects. `quick-keyboard.test.ts`
 * asserts both properties against the real parser and the real matcher, so a relabelling cannot
 * quietly produce a button that files a fare under Other Expense or fails to parse at all.
 *
 * Only the fixed fares get a button. Grab, TNVS and taxi vary per trip, and a button that has to
 * ask "how much?" is no faster than typing `250 grab`, which already works and always has.
 */

/**
 * Telegram's reply keyboard, narrowed to the fields used here.
 *
 * A `type` and not an `interface` on purpose: `sendMessage` takes `Record<string, unknown>`,
 * and only a type alias gets the implicit index signature that satisfies it.
 */
export type ReplyKeyboard = {
  keyboard: { text: string }[][];
  resize_keyboard: true;
  is_persistent: true;
  input_field_placeholder: string;
};

/** Telegram's instruction to take the keyboard away again. Also a type alias, for the reason
 *  above. */
export type RemoveKeyboard = {
  remove_keyboard: true;
};

/**
 * The routine fares, as shorthand.
 *
 * Hardcoded on purpose for now. Storing them per user means a column, an editor and a settings
 * page, which is most of the work this whole approach exists to avoid. If a second person ever
 * uses this bot, that is the point to make them data - not before.
 */
export const QUICK_FARES = [
  "38 fare to office",
  "80 fare home (UV)",
  "95 fare home (UV + jeep)",
] as const;

/**
 * The keyboard, laid out so the outbound leg sits alone and the two return options pair up.
 *
 * `is_persistent` keeps it up between messages rather than collapsing after one use, which is the
 * whole point: the friction being removed is remembering to open a keyboard at all.
 */
export const quickKeyboard = (): ReplyKeyboard => ({
  keyboard: [
    [{ text: QUICK_FARES[0] }],
    [{ text: QUICK_FARES[1] }, { text: QUICK_FARES[2] }],
    [{ text: "/summary" }, { text: "/recent" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  // A permanent reminder that anything not on a button is still just typed. Without it the
  // keyboard reads as the only way in, and a Grab fare looks unsupported.
  input_field_placeholder: "or type: 250 grab",
});

export const removeQuickKeyboard = (): RemoveKeyboard => ({ remove_keyboard: true });

/**
 * Whether `/keyboard ...` means "take it away".
 *
 * `resolveCommand` only reads the first token, so the argument has to be read from the raw text
 * here. Anything other than an explicit off word shows the keyboard, since that is the harmless
 * direction to misread: an unwanted keyboard is dismissed with one command, a missing one leaves
 * the user typing.
 */
export const wantsKeyboardOff = (text: string): boolean =>
  // `\b` was wrong here: it matches before punctuation as well as at the end, so
  // "/keyboard off-topic" and "/keyboard off." both hid the keyboard. Whitespace-or-end is what
  // "the word ended" actually means. "/keyboard offer" was always fine, since `\b` does not match
  // between two word characters.
  /^\/keyboard(@\S+)?\s+(off|hide|remove|stop)(?:\s|$)/i.test(text.trim());
