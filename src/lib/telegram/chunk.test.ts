import { describe, expect, it } from "vitest";
import { TELEGRAM_MAX_TEXT, chunkMessage } from "@/lib/telegram/chunk";

describe("chunkMessage", () => {
  it("leaves a message that already fits alone", () => {
    expect(chunkMessage("hello")).toEqual(["hello"]);
  });

  // The bug this covers: Telegram rejects an over-long message outright, and the plain-text
  // fallback is the same length, so every attempt failed and the caller acknowledged the update
  // having sent nothing. The user got silence.
  it("splits a message that exceeds the limit", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `- category number ${i} with a long name`);
    const chunks = chunkMessage(lines.join("\n"));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_TEXT);
  });

  it("loses no content", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `- category number ${i}`);
    const text = lines.join("\n");
    expect(chunkMessage(text).join("\n")).toBe(text);
  });

  it("breaks on line boundaries, so a Markdown entity is never cut in half", () => {
    const text = Array.from({ length: 300 }, (_, i) => `*bold entry ${i}* trailing text here`).join("\n");
    for (const chunk of chunkMessage(text)) {
      // An odd number of asterisks would mean a split mid-entity.
      expect((chunk.match(/\*/g) ?? []).length % 2).toBe(0);
    }
  });

  it("hard-splits a single line with no break to use", () => {
    const chunks = chunkMessage("x".repeat(TELEGRAM_MAX_TEXT * 2 + 5));
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_TEXT);
  });

  it("packs lines rather than emitting one chunk per line", () => {
    const chunks = chunkMessage(Array.from({ length: 200 }, () => "short").join("\n"), 50);
    expect(chunks.length).toBeLessThan(200);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(50);
  });
});
