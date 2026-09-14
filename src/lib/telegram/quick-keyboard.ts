/**
 * The buttons pinned above the message box, built from the user's quick-log tiles.
 *
 * A `ReplyKeyboardMarkup` button **sends its own label as an ordinary message**. The keyboard used
 * to lean on that directly: every button was complete shorthand (`38 fare to office`) that the
 * logging path parsed like anything typed. That made the buttons a hardcoded list, since a label
 * had to be valid shorthand and resolve to the right category at build time, and it ruled out
 * anything without a fixed amount.
 *
 * The buttons now come from `telegram_quick_tiles`, the rows `/quick-log` and the Mini App already
 * edit, so one editor controls every surface. A button's text is deliberately **not** shorthand:
 * the bot recognises it by shape (`looksLikeTileButton`), fetches the tiles fresh and matches the
 * text exactly (`matchTileButton`), then logs with the tile's own category and pinned labels. An
 * amountless tile asks for a figure instead of logging.
 *
 * Pure: no I/O, so the text a button carries and the text the bot matches cannot drift apart.
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

/** The parts of a tile the keyboard needs. `QuickTileView` satisfies it. */
export interface KeyboardTile {
  id: string;
  label: string;
  /** Null means the button asks for an amount rather than logging one. */
  amount: number | null;
}

/**
 * How many tiles the keyboard carries.
 *
 * The dashboard strip's number, and for the same reason: tiles arrive in `sortOrder`, so reorder
 * on `/quick-log` already decides which appear, and a longer keyboard covers the chat it sits under.
 */
export const KEYBOARD_TILE_LIMIT = 6;

/** The command row under the tiles. Fixed, so a thumb finds them in the same place every time. */
export const QUICK_COMMANDS = ["/summary", "/recent"] as const;

/** Between the label and the amount. A middle dot, which nobody types, so the shape is recognisable. */
const TILE_SEPARATOR = " · ";

/** What an amountless tile shows where the figure would be. */
const ASK_MARK = "?";

/**
 * A tile's amount as a button shows it: `38`, `37.50`, and `38.999` when that is what is stored.
 *
 * Never rounded. A tap logs the stored `amount`, and the Mini App's editor saves whatever precision
 * was typed (only the web form bounds it to two decimals), so rounding here would show `₱39.00` on a
 * button that writes `38.999`. Two decimals are used only when they represent the value exactly.
 *
 * No thousands separator. A comma is an entry separator to `parseShorthandEntries`, and although a
 * button is matched before shorthand is tried, the text should not depend on that ordering to be
 * safe.
 */
const formatTileAmount = (amount: number): string => {
  if (Number.isInteger(amount)) return String(amount);
  const cents = amount.toFixed(2);
  return Number(cents) === amount ? cents : String(amount);
};

/** The exact text a tile's button carries, and therefore the exact text a tap sends back. */
export const tileButtonText = (tile: KeyboardTile, symbol: string): string =>
  `${tile.label}${TILE_SEPARATOR}${symbol}${tile.amount === null ? ASK_MARK : formatTileAmount(tile.amount)}`;

/** The parts of a Frequent entry the keyboard needs. `FrequentTileView` satisfies it. */
export interface KeyboardFrequent {
  key: string;
  description: string;
  amount: number | null;
  amountIsStable: boolean;
}

/**
 * A Frequent entry as a button: its description as the label, and its amount only when one tap may
 * log it.
 *
 * An unstable amount shows `?` and asks, the rule the Mini App already follows: the user may assert
 * a fixed amount, the system may never infer one. The id is namespaced so it cannot equal a tile id.
 */
export const frequentAsTile = (entry: KeyboardFrequent): KeyboardTile => ({
  id: `frequent:${entry.key}`,
  label: entry.description,
  amount: entry.amountIsStable ? entry.amount : null,
});

/**
 * What the keyboard carries: saved buttons first, then Frequent entries into the slots left.
 *
 * Saved buttons always win a slot, because they are the ones the user chose. A Frequent entry is
 * skipped when its button text equals a saved tile's, since a tap is matched against saved tiles
 * first and would log the tile rather than the entry the button showed. Nor are two Frequent
 * buttons ever given the same text, which would make the second unreachable.
 */
export const keyboardButtons = (
  tiles: KeyboardTile[],
  frequent: KeyboardFrequent[],
  symbol: string
): KeyboardTile[] => {
  const buttons = tiles.slice(0, KEYBOARD_TILE_LIMIT);
  const taken = new Set(tiles.map((t) => tileButtonText(t, symbol)));

  for (const entry of frequent) {
    if (buttons.length >= KEYBOARD_TILE_LIMIT) break;
    const button = frequentAsTile(entry);
    const text = tileButtonText(button, symbol);
    if (taken.has(text)) continue;
    taken.add(text);
    buttons.push(button);
  }

  return buttons;
};

/**
 * The Frequent entry a message was sent by, or null. Checked only after the saved tiles miss.
 *
 * Built through `frequentAsTile` so the text matched is exactly the text the button carried.
 */
export const matchFrequentButton = <F extends KeyboardFrequent>(
  text: string,
  frequent: F[],
  symbol: string
): F | null => {
  const trimmed = text.trim();
  return frequent.find((f) => tileButtonText(frequentAsTile(f), symbol) === trimmed) ?? null;
};

/**
 * The keyboard: up to `KEYBOARD_TILE_LIMIT` tiles two to a row, then the command row.
 *
 * Two per row because label and amount together are wider than a bare fare label was. With no
 * tiles the command row still shows, so the keyboard is never an empty strip.
 */
export const quickKeyboard = (tiles: KeyboardTile[], symbol: string): ReplyKeyboard => {
  const buttons = tiles
    .slice(0, KEYBOARD_TILE_LIMIT)
    .map((t) => ({ text: tileButtonText(t, symbol) }));
  const rows: { text: string }[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push(QUICK_COMMANDS.map((text) => ({ text })));

  return {
    keyboard: rows,
    resize_keyboard: true,
    // `is_persistent` keeps it up between messages rather than collapsing after one use, which is
    // the whole point: the friction being removed is remembering to open a keyboard at all.
    is_persistent: true,
    // A permanent reminder that anything not on a button is still just typed. Without it the
    // keyboard reads as the only way in.
    input_field_placeholder: "or type: 250 grab",
  };
};

export const removeQuickKeyboard = (): RemoveKeyboard => ({ remove_keyboard: true });

/**
 * Whether a message has the shape of a tile button: `<label> · <symbol><amount or ?>`.
 *
 * A cheap gate, checked before anything is fetched, so an ordinary message never pays for a tile
 * read. Shape only: a match still has to be confirmed against the live tiles, because the button
 * may have been renamed or deleted since the keyboard was sent.
 */
export const looksLikeTileButton = (text: string, symbol: string): boolean => {
  const trimmed = text.trim();
  const marker = `${TILE_SEPARATOR}${symbol}`;
  const at = trimmed.lastIndexOf(marker);
  if (at <= 0) return false;
  // Any number of decimals, because `formatTileAmount` shows an unrounded amount in full.
  return /^(\?|\d+(\.\d+)?)$/.test(trimmed.slice(at + marker.length));
};

/**
 * The tile a message was sent by, or null.
 *
 * Matched against **every** tile, not just the ones the keyboard shows, so a button still on the
 * phone after its tile was reordered out of the first six keeps logging. Exact text, which is safe
 * because the write rules refuse two tiles with the same label.
 */
export const matchTileButton = <T extends KeyboardTile>(
  text: string,
  tiles: T[],
  symbol: string
): T | null => {
  const trimmed = text.trim();
  return tiles.find((t) => tileButtonText(t, symbol) === trimmed) ?? null;
};

/**
 * A reply that is only an amount: `180`, `1,200`, `37.5`. Null for anything else.
 *
 * Deliberately narrow. This answers "how much?" after an amountless button, and anything with words
 * in it (`180 lunch`) is an ordinary message that should log the usual way instead.
 */
export const parseBareAmount = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(trimmed)) return null;
  const amount = Number(trimmed.replace(/,/g, ""));
  return amount > 0 ? amount : null;
};

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
