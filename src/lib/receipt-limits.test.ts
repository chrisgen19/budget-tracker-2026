import { describe, expect, it } from "vitest";
import { MAX_BASE64_LENGTH, MAX_FILE_SIZE } from "@/lib/receipt-limits";

describe("receipt size limits", () => {
  // The bug this covers: the MCP tool accepted an unbounded string, so an oversized payload was
  // parsed as JSON and then allocated again by Buffer.from before the 4 MB check ran. The encoded
  // length is the only one available before decoding.
  it("admits a base64 payload that decodes to exactly the limit", () => {
    const encoded = Buffer.alloc(MAX_FILE_SIZE).toString("base64");
    expect(encoded.length).toBeLessThanOrEqual(MAX_BASE64_LENGTH);
  });

  it("excludes anything meaningfully over the limit", () => {
    for (const over of [3, 1024, MAX_FILE_SIZE]) {
      const encoded = Buffer.alloc(MAX_FILE_SIZE + over).toString("base64");
      expect(encoded.length, `${over} bytes over`).toBeGreaterThan(MAX_BASE64_LENGTH);
    }
  });

  it("cannot resolve the last two bytes, which is what the decoded check is for", () => {
    // Base64 encodes in 3-byte groups, so 4194305 and 4194306 bytes encode to the same length as
    // 4194304. The encoded cap is a memory bound, not the precise limit; `authorizeReceiptScan`
    // still measures the decoded buffer, and that is what rejects these.
    for (const over of [1, 2]) {
      const encoded = Buffer.alloc(MAX_FILE_SIZE + over).toString("base64");
      expect(encoded.length).toBe(MAX_BASE64_LENGTH);
    }
  });

  it("is not so loose that a rejected payload is still huge", () => {
    // 4 chars per 3 bytes, so the encoded ceiling should sit just above 4/3 of the decoded one.
    expect(MAX_BASE64_LENGTH).toBeLessThan(MAX_FILE_SIZE * 1.4);
  });
});
