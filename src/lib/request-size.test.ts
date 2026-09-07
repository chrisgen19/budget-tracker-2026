import { describe, expect, it } from "vitest";
import { overBodySizeLimit, readJsonWithinLimit } from "@/lib/request-size";

const LIMIT = 1024;

/** A body sent with no `content-length`, the shape a header check cannot see. */
const chunkedRequest = (payload: string, chunkSize = 64) =>
  new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(payload);
        for (let at = 0; at < bytes.byteLength; at += chunkSize) {
          controller.enqueue(bytes.slice(at, at + chunkSize));
        }
        controller.close();
      },
    }),
    // Undici requires this for a stream body; it does not add a content-length.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

const declaredRequest = (payload: string, contentLength: number) =>
  new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", "content-length": String(contentLength) },
    body: payload,
  });

const padded = (bytes: number) => JSON.stringify({ pad: "x".repeat(bytes) });

describe("overBodySizeLimit", () => {
  it("refuses a declared length above the limit", () => {
    expect(overBodySizeLimit(declaredRequest("{}", LIMIT + 1), LIMIT)).toBe(true);
  });

  it("accepts a declared length at the limit", () => {
    expect(overBodySizeLimit(declaredRequest("{}", LIMIT), LIMIT)).toBe(false);
  });

  it("accepts a request that declares nothing, since a header is only a claim", () => {
    expect(overBodySizeLimit(new Request("http://localhost/api/test"), LIMIT)).toBe(false);
  });
});

describe("readJsonWithinLimit", () => {
  it("parses a body under the limit", async () => {
    const result = await readJsonWithinLimit(declaredRequest('{"a":1}', 7), LIMIT);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("refuses on the declared length without reading the stream", async () => {
    const request = declaredRequest(padded(LIMIT * 2), LIMIT * 2);
    const result = await readJsonWithinLimit(request, LIMIT);
    expect(result.ok).toBe(false);
    // Untouched: the refusal never opened it.
    expect(request.bodyUsed).toBe(false);
  });

  it("refuses an oversized body that declares no content-length", async () => {
    // The regression this exists for: a chunked request skips the header check entirely, so
    // without the metered read an 8 MB batch would reach request.json() unopposed.
    const result = await readJsonWithinLimit(chunkedRequest(padded(LIMIT * 4)), LIMIT);
    expect(result.ok).toBe(false);
  });

  it("parses a chunked body that stays under the limit", async () => {
    const result = await readJsonWithinLimit(chunkedRequest('{"a":"' + "x".repeat(200) + '"}'), LIMIT);
    expect(result).toEqual({ ok: true, value: { a: "x".repeat(200) } });
  });

  it("reassembles a multi-chunk body rather than reading only the first chunk", async () => {
    const payload = JSON.stringify({ items: Array.from({ length: 20 }, (_, i) => i) });
    const result = await readJsonWithinLimit(chunkedRequest(payload, 8), LIMIT);
    expect(result).toEqual({ ok: true, value: JSON.parse(payload) });
  });

  it("throws on malformed JSON, the way request.json() always did", async () => {
    await expect(readJsonWithinLimit(chunkedRequest("{not json"), LIMIT)).rejects.toThrow(
      SyntaxError,
    );
  });
});
