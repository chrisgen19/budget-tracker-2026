import { describe, expect, it } from "vitest";
import { receiptDateLooksOff } from "@/lib/telegram/date-sanity";

describe("receiptDateLooksOff", () => {
  it("says nothing when the photo has no capture date", () => {
    expect(receiptDateLooksOff("2026-08-01", null)).toBe(false);
  });

  it("accepts a receipt photographed the same day", () => {
    expect(receiptDateLooksOff("2026-08-01", "2026-08-01T20:05:04")).toBe(false);
  });

  it("accepts a receipt photographed a couple of days later", () => {
    // Photographing a receipt a day or two after buying is ordinary and must not nag.
    expect(receiptDateLooksOff("2026-08-01", "2026-08-03T09:00:00")).toBe(false);
  });

  it("flags a wide gap, which usually means one of the two was misread", () => {
    expect(receiptDateLooksOff("2026-08-01", "2026-08-20T09:00:00")).toBe(true);
    // A smudged 08 read as 03 is the common shape of this.
    expect(receiptDateLooksOff("2026-03-01", "2026-08-01T20:05:04")).toBe(true);
  });

  it("always flags a photo that predates its own receipt", () => {
    // Impossible, so there is no threshold to apply: one of the dates is wrong.
    expect(receiptDateLooksOff("2026-08-05", "2026-08-04T20:05:04")).toBe(true);
  });

  it("ignores values it cannot parse rather than warning on noise", () => {
    expect(receiptDateLooksOff("not-a-date", "2026-08-01T20:05:04")).toBe(false);
    expect(receiptDateLooksOff("2026-08-01", "nonsense")).toBe(false);
  });
});
