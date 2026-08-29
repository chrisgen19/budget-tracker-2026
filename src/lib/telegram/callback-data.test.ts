import { describe, expect, it } from "vitest";
import { encodeScanCallback, parseScanCallback } from "@/lib/telegram/callback-data";

/**
 * The update id in the payload is the point, not a detail. Buttons never expire from Telegram's
 * chat history, so an old review stays tappable — and without an identity the press would act on
 * whichever scan is pending now, showing one amount and saving another.
 */
describe("scan callback payload", () => {
  it("round-trips both actions", () => {
    for (const action of ["save", "discard"] as const) {
      expect(parseScanCallback(encodeScanCallback({ action, updateId: 4242 }))).toEqual({
        action,
        updateId: 4242,
      });
    }
  });

  it("stays inside Telegram's 64-byte callback_data cap", () => {
    // Update ids grow without bound; the cap does not.
    const encoded = encodeScanCallback({ action: "discard", updateId: Number.MAX_SAFE_INTEGER });
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(64);
  });

  it("rejects anything this bot did not author", () => {
    for (const data of ["", "yes", "rs", "rs:y", "other:y:1", "rs:x:1", undefined, null, 7, {}]) {
      expect(parseScanCallback(data)).toBeNull();
    }
  });

  it("rejects an update id that is not a positive integer", () => {
    // Number("") is 0 — a valid-looking id belonging to no scan.
    for (const bad of ["rs:y:", "rs:y:0", "rs:y:-3", "rs:y:1.5", "rs:y:abc", "rs:y:01"]) {
      expect(parseScanCallback(bad)).toBeNull();
    }
    expect(parseScanCallback(`rs:y:${Number.MAX_SAFE_INTEGER + 2}`)).toBeNull();
  });
});
