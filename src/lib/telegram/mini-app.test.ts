import { describe, expect, it } from "vitest";
import {
  MENU_BUTTON_MAX_TEXT,
  MENU_BUTTON_TEXT,
  menuButtonRegistrations,
  miniAppButtonRow,
  miniAppKeyboard,
  miniAppUrl,
} from "@/lib/telegram/mini-app";

describe("miniAppUrl", () => {
  it("appends /tg to the configured base", () => {
    expect(miniAppUrl({ TELEGRAM_APP_URL: "https://budget.test" })).toBe("https://budget.test/tg");
    expect(miniAppUrl({ NEXTAUTH_URL: "https://budget.test/" })).toBe("https://budget.test/tg");
  });

  it("prefers the explicit override, as appBaseUrl does", () => {
    expect(
      miniAppUrl({ TELEGRAM_APP_URL: "https://a.test", NEXTAUTH_URL: "https://b.test" })
    ).toBe("https://a.test/tg");
  });

  // The one rule this module adds on top of appBaseUrl. Telegram frames a Mini App inside the
  // client and refuses an insecure origin, so http:// is not a degraded button -- it is a rejected
  // message. `appBaseUrl` allows it because a plain URL button does.
  it("refuses http, which a plain URL button would have accepted", () => {
    expect(miniAppUrl({ NEXTAUTH_URL: "http://localhost:3000" })).toBeNull();
    expect(miniAppUrl({ TELEGRAM_APP_URL: "http://budget.test" })).toBeNull();
  });

  it("returns null for anything unusable, rather than something Telegram would reject", () => {
    for (const url of ["", "   ", "budget.test", "not a url", "https://app.example invalid"]) {
      expect(miniAppUrl({ NEXTAUTH_URL: url }), url).toBeNull();
    }
    expect(miniAppUrl({})).toBeNull();
  });

  it("treats a blank override as unset and falls back", () => {
    expect(miniAppUrl({ TELEGRAM_APP_URL: "  ", NEXTAUTH_URL: "https://b.test" })).toBe(
      "https://b.test/tg"
    );
  });
});

describe("menuButtonRegistrations", () => {
  const URL_ = "https://budget.test/tg";

  // The same bug `menuRegistrations` covers, one surface along: the default scope is what every
  // stranger who finds the bot sees, and a Menu button there hands them a page that 401s.
  it("never publishes a web_app button to the default scope", () => {
    const calls = menuButtonRegistrations(["7117005308"], URL_);
    const published = calls.filter(
      (c) => (c.params.menu_button as { type: string }).type === "web_app"
    );

    expect(published).toHaveLength(1);
    expect(published[0].params.chat_id).toBe(7117005308);
  });

  it("clears the default scope first, in case an earlier build published one", () => {
    expect(menuButtonRegistrations(["7117005308"], URL_)[0]).toEqual({
      method: "setChatMenuButton",
      params: { menu_button: { type: "default" } },
    });
  });

  it("carries the Mini App URL to each allowlisted chat", () => {
    const calls = menuButtonRegistrations(["111", "222"], URL_);
    expect(calls).toHaveLength(3);
    for (const call of calls.slice(1)) {
      expect(call.params.menu_button).toEqual({
        type: "web_app",
        text: MENU_BUTTON_TEXT,
        web_app: { url: URL_ },
      });
    }
  });

  // The half that is easy to leave out: a deployment that loses TELEGRAM_APP_URL would otherwise
  // keep a button pointing at a host it no longer controls, found only by tapping it.
  it("clears a stale button when there is no usable URL, rather than leaving it", () => {
    const calls = menuButtonRegistrations(["111"], null);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.params.menu_button).toEqual({ type: "default" });
    }
    expect(calls[1].params.chat_id).toBe(111);
  });

  it("skips anything that is not a chat id, since a username cannot address a chat", () => {
    const calls = menuButtonRegistrations(["", "  ", "abc", "0", "-100", "01", "12.5"], URL_);
    expect(calls).toHaveLength(1);
  });

  it("keeps the button text short enough for the space beside the message box", () => {
    expect(MENU_BUTTON_TEXT.length).toBeGreaterThan(0);
    expect(MENU_BUTTON_TEXT.length).toBeLessThanOrEqual(MENU_BUTTON_MAX_TEXT);
  });
});

describe("miniAppKeyboard", () => {
  it("builds a single web_app button", () => {
    expect(miniAppKeyboard("https://budget.test/tg", "Open")).toEqual({
      inline_keyboard: [[{ text: "Open", web_app: { url: "https://budget.test/tg" } }]],
    });
  });

  // Undefined and not an empty keyboard: `{ inline_keyboard: [] }` is a message with no buttons
  // that still spends the field, and undefined is what the send path treats as "no markup".
  it("is undefined with no URL, so the message still sends", () => {
    expect(miniAppKeyboard(null, "Open")).toBeUndefined();
  });
});

describe("miniAppButtonRow", () => {
  it("spreads into a keyboard that carries other buttons", () => {
    expect(miniAppButtonRow("https://budget.test/tg", "Open")).toEqual([
      [{ text: "Open", web_app: { url: "https://budget.test/tg" } }],
    ]);
  });

  // The evening prompt's own requirement: losing the grid must not cost it "Nothing today".
  it("is an empty list with no URL, leaving one fewer row rather than a hole", () => {
    expect(miniAppButtonRow(null, "Open")).toEqual([]);
  });
});
