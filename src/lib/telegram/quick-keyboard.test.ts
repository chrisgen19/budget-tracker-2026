import { describe, expect, it } from "vitest";
import {
  KEYBOARD_TILE_LIMIT,
  QUICK_COMMANDS,
  looksLikeTileButton,
  matchTileButton,
  parseBareAmount,
  quickKeyboard,
  removeQuickKeyboard,
  tileButtonText,
  wantsKeyboardOff,
  type KeyboardTile,
} from "@/lib/telegram/quick-keyboard";
import { resolveCommand } from "@/lib/telegram/commands";
import { parseShorthandEntries } from "@/lib/telegram/multi-shorthand";

const PESO = "₱";

const tile = (label: string, amount: number | null): KeyboardTile => ({
  id: label,
  label,
  amount,
});

const TILES: KeyboardTile[] = [
  tile("Office", 38),
  tile("Home UV", 80),
  tile("Grab", null),
  tile("Lunch", null),
  tile("Jeep", 13.5),
  tile("Coffee", 120),
  tile("Taxi", null),
];

const texts = (tiles: KeyboardTile[]) =>
  quickKeyboard(tiles, PESO).keyboard.flat().map((b) => b.text);

describe("tileButtonText", () => {
  it("shows the label and the amount a tap logs", () => {
    expect(tileButtonText(tile("Office", 38), PESO)).toBe(`Office · ${PESO}38`);
  });

  it("shows two decimals for a fractional amount", () => {
    expect(tileButtonText(tile("Jeep", 13.5), PESO)).toBe(`Jeep · ${PESO}13.50`);
  });

  it("marks a button that asks for its amount", () => {
    expect(tileButtonText(tile("Grab", null), PESO)).toBe(`Grab · ${PESO}?`);
  });

  // A comma splits entries in `parseShorthandEntries`. The button is matched first, but its text
  // should not rely on that ordering to be safe.
  it("never puts a thousands separator in the amount", () => {
    expect(tileButtonText(tile("Rent", 12000), PESO)).not.toContain(",");
  });

  // The old keyboard's buttons *were* shorthand. These must not be, or a tap would log twice as
  // much meaning: once as the tile, and once as whatever the parser made of the text.
  it("never reads as shorthand or as a command", () => {
    for (const t of TILES) {
      const text = tileButtonText(t, PESO);
      expect(parseShorthandEntries(text), text).toEqual([]);
      expect(resolveCommand(text), text).toBeNull();
    }
  });
});

describe("quickKeyboard", () => {
  it("stays up between messages and keeps typing visible as an option", () => {
    const kb = quickKeyboard(TILES, PESO);
    expect(kb.is_persistent).toBe(true);
    expect(kb.resize_keyboard).toBe(true);
    expect(kb.input_field_placeholder).toMatch(/type/i);
  });

  it("carries the first tiles in order, two to a row, then the command row", () => {
    const { keyboard } = quickKeyboard(TILES, PESO);
    expect(keyboard.slice(0, 3).every((row) => row.length === 2)).toBe(true);
    expect(keyboard.at(-1)?.map((b) => b.text)).toEqual([...QUICK_COMMANDS]);
    expect(texts(TILES)).toHaveLength(KEYBOARD_TILE_LIMIT + QUICK_COMMANDS.length);
    expect(texts(TILES)[0]).toBe(tileButtonText(TILES[0], PESO));
  });

  // Reorder on /quick-log decides what shows, exactly as it does for the dashboard strip.
  it("leaves out tiles past the limit", () => {
    expect(texts(TILES)).not.toContain(tileButtonText(TILES[KEYBOARD_TILE_LIMIT], PESO));
  });

  it("still shows the command row when there are no tiles", () => {
    expect(quickKeyboard([], PESO).keyboard).toEqual([QUICK_COMMANDS.map((text) => ({ text }))]);
  });

  it("puts an odd tile out on its own row", () => {
    const { keyboard } = quickKeyboard(TILES.slice(0, 3), PESO);
    expect(keyboard.map((row) => row.length)).toEqual([2, 1, QUICK_COMMANDS.length]);
  });

  it("offers commands the bot actually handles", () => {
    for (const command of QUICK_COMMANDS) expect(resolveCommand(command), command).not.toBeNull();
  });

  it("removes the keyboard rather than replacing it with an empty one", () => {
    expect(removeQuickKeyboard()).toEqual({ remove_keyboard: true });
  });
});

describe("looksLikeTileButton", () => {
  it("recognises every button the keyboard can carry", () => {
    for (const t of TILES) {
      expect(looksLikeTileButton(tileButtonText(t, PESO), PESO), t.label).toBe(true);
    }
  });

  // The gate decides whether a message costs a tile read, so ordinary logging must not trip it.
  it("ignores ordinary messages", () => {
    for (const text of ["250 grab", "summary", "/recent", "38 fare to office", "grab ? 20", `${PESO}38`]) {
      expect(looksLikeTileButton(text, PESO), text).toBe(false);
    }
  });

  it("rejects a separator with nothing before it", () => {
    expect(looksLikeTileButton(` · ${PESO}38`, PESO)).toBe(false);
  });
});

describe("matchTileButton", () => {
  it("finds the tile a button was built from", () => {
    for (const t of TILES) expect(matchTileButton(tileButtonText(t, PESO), TILES, PESO)).toBe(t);
  });

  // A button left on the phone after its tile was reordered out of the first six still logs.
  it("matches tiles the keyboard no longer shows", () => {
    const hidden = TILES[KEYBOARD_TILE_LIMIT];
    expect(matchTileButton(tileButtonText(hidden, PESO), TILES, PESO)).toBe(hidden);
  });

  // Renamed or re-priced on the web since the keyboard was sent: nothing may log.
  it("misses when the tile has changed since the button was sent", () => {
    const sent = tileButtonText(tile("Office", 38), PESO);
    expect(matchTileButton(sent, [tile("Office", 40)], PESO)).toBeNull();
    expect(matchTileButton(sent, [tile("To office", 38)], PESO)).toBeNull();
  });
});

describe("parseBareAmount", () => {
  it("reads a reply that is only an amount", () => {
    expect(parseBareAmount("180")).toBe(180);
    expect(parseBareAmount(" 37.5 ")).toBe(37.5);
    expect(parseBareAmount("1,200")).toBe(1200);
  });

  it("refuses anything that is not only a positive amount", () => {
    for (const text of ["0", "-5", "180 lunch", "1,20", "12.345", "abc", "", "+50"]) {
      expect(parseBareAmount(text), text).toBeNull();
    }
  });
});

describe("wantsKeyboardOff", () => {
  it("recognises the off words", () => {
    for (const text of ["/keyboard off", "/keyboard hide", "/keyboard  remove", "/KEYBOARD Off"]) {
      expect(wantsKeyboardOff(text), text).toBe(true);
    }
  });

  // Telegram appends @botname wherever more than one bot can see the message.
  it("recognises the off words with a bot suffix", () => {
    expect(wantsKeyboardOff("/keyboard@mybot off")).toBe(true);
  });

  // `\b` matches before punctuation as well as at a word end, so these all removed the keyboard.
  // Near misses rather than realistic input, but the predicate should mean what it says.
  it("does not treat a longer word starting with an off-token as the command", () => {
    for (const text of ["/keyboard off-topic", "/keyboard off.", "/keyboard off!", "/keyboard stopwatch"]) {
      expect(wantsKeyboardOff(text), text).toBe(false);
    }
  });

  // Showing an unwanted keyboard costs one command to undo. Failing to show a wanted one leaves
  // the user typing, which is the thing this exists to stop.
  it("shows the keyboard for anything else", () => {
    for (const text of ["/keyboard", "/keyboard on", "/keyboard please", "keyboard"]) {
      expect(wantsKeyboardOff(text), text).toBe(false);
    }
  });
});
