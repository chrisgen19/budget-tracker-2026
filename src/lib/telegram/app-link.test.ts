import { describe, expect, it } from "vitest";
import { appBaseUrl, openInAppKeyboard, transactionLink } from "@/lib/telegram/app-link";

/**
 * The failure that matters here is not a missing button, it is a *broken* one: Telegram rejects
 * the whole message when a keyboard carries an invalid URL, so a bad base URL would cost the
 * confirmation itself rather than just the link.
 */
describe("appBaseUrl", () => {
  it("prefers the explicit override, then falls back to the session URL", () => {
    expect(appBaseUrl({ TELEGRAM_APP_URL: "https://a.test", NEXTAUTH_URL: "https://b.test" })).toBe(
      "https://a.test"
    );
    expect(appBaseUrl({ NEXTAUTH_URL: "https://b.test" })).toBe("https://b.test");
  });

  it("trims a trailing slash so the path is not doubled", () => {
    expect(appBaseUrl({ NEXTAUTH_URL: "https://a.test/" })).toBe("https://a.test");
    expect(appBaseUrl({ NEXTAUTH_URL: "https://a.test///" })).toBe("https://a.test");
  });

  it("returns null for anything Telegram would reject", () => {
    // Blank counts as unset, as it does for every TELEGRAM_ variable.
    for (const url of ["", "   ", "budget.example.com", "ftp://a.test", "not a url"]) {
      expect(appBaseUrl({ NEXTAUTH_URL: url })).toBeNull();
    }
    expect(appBaseUrl({})).toBeNull();
  });

  it("hardcodes nothing", () => {
    // A fork or a staging deploy must never be handed a link into someone else's budget — the
    // same rule TELEGRAM_MCP_URL follows.
    expect(appBaseUrl({})).toBeNull();
  });
});

describe("transactionLink", () => {
  it("deep-links to the row's edit modal", () => {
    // `?highlight=` is an existing route contract: the page clears the month filter, finds the row
    // across all time and opens its edit modal — where editing and deleting already live.
    expect(transactionLink("https://a.test", "tx_1")).toBe(
      "https://a.test/transactions?highlight=tx_1"
    );
  });

  it("escapes the id rather than trusting it", () => {
    expect(transactionLink("https://a.test", "a b&c")).toBe(
      "https://a.test/transactions?highlight=a%20b%26c"
    );
  });

  it("returns null with no base url or no id", () => {
    expect(transactionLink(null, "tx_1")).toBeNull();
    expect(transactionLink("https://a.test", "  ")).toBeNull();
  });
});

describe("openInAppKeyboard", () => {
  it("builds a single url button", () => {
    expect(openInAppKeyboard("https://a.test", "tx_1")).toEqual({
      inline_keyboard: [[{ text: "✏️ Edit in app", url: "https://a.test/transactions?highlight=tx_1" }]],
    });
  });

  it("is undefined rather than an empty keyboard when it cannot be built", () => {
    // Undefined is what the send path already treats as "no markup"; an empty inline_keyboard
    // spends the field and renders nothing.
    expect(openInAppKeyboard(null, "tx_1")).toBeUndefined();
  });
});
