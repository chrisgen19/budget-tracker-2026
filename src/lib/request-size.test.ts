// @vitest-environment node
// Server code: jsdom swaps in its own `File`, which undici's multipart parser refuses to build.
import { describe, expect, it } from "vitest";
import { overBodySizeLimit, readFormDataWithinLimit, readJsonWithinLimit } from "@/lib/request-size";

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

const padded = (bytes: number) => JSON.stringify({ pad: "y".repeat(bytes) });

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

  // The coalescing buffer starts at 64 KB and doubles, capped at the limit. These pin the seams
  // where a growth off-by-one would live, and the tiny-chunk case is the one the buffer exists
  // for: a sender picks the chunk size, so bytes alone do not bound how many objects arrive.
  const BIG_LIMIT = 2 * 1024 * 1024;

  /** Asserted on length rather than by deep-equalling megabytes, so a failure stays readable. */
  const expectPadOfLength = (result: Awaited<ReturnType<typeof readJsonWithinLimit>>, size: number) => {
    expect(result.ok).toBe(true);
    const pad = (result as { ok: true; value: { pad: string } }).value.pad;
    expect(pad.length).toBe(size);
    expect(pad.endsWith("yy")).toBe(true);
  };

  it.each([
    ["under the initial buffer", 1_000],
    ["astride the first growth", 64 * 1024 + 1],
    // `padded` adds 12 bytes of JSON around the string, so leave room under the ceiling.
    ["just under the limit", BIG_LIMIT - 64],
  ])("reassembles a body %s", async (_name, size) => {
    const result = await readJsonWithinLimit(chunkedRequest(padded(size), 4_096), BIG_LIMIT);
    expectPadOfLength(result, size);
  });

  it("reassembles a body delivered one byte at a time", async () => {
    const result = await readJsonWithinLimit(chunkedRequest(padded(300), 1), LIMIT);
    expectPadOfLength(result, 300);
  });

  it("refuses on the byte that crosses the limit, however finely it is sliced", async () => {
    const result = await readJsonWithinLimit(chunkedRequest(padded(LIMIT * 2), 1), LIMIT);
    expect(result.ok).toBe(false);
  });

  it("throws on malformed JSON, the way request.json() always did", async () => {
    await expect(readJsonWithinLimit(chunkedRequest("{not json"), LIMIT)).rejects.toThrow(
      SyntaxError,
    );
  });
});

describe("readFormDataWithinLimit", () => {
  const BOUNDARY = "test-boundary-1234";
  type Part = { name: string; value: string; filename?: string; type?: string };
  /**
   * A real multipart body, streamed with no content-length, as a chunked upload sends it.
   * Encoded by hand: jsdom's FormData is not one undici's `Response` knows how to serialise.
   */
  const chunkedMultipart = (parts: Part[]) => {
    const text =
      parts
        .map((p) => {
          const disposition = `Content-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ""}`;
          const type = p.type ? `\r\nContent-Type: ${p.type}` : "";
          return `--${BOUNDARY}\r\n${disposition}${type}\r\n\r\n${p.value}\r\n`;
        })
        .join("") + `--${BOUNDARY}--\r\n`;
    const bytes = new TextEncoder().encode(text);
    return new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (let at = 0; at < bytes.byteLength; at += 64) controller.enqueue(bytes.slice(at, at + 64));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  };

  it("parses a multipart body under the limit, keeping the boundary", async () => {
    const request = chunkedMultipart([
      { name: "photoKey", value: "k1" },
      { name: "photo", value: "jpeg", filename: "r.jpg", type: "image/jpeg" },
    ]);
    const result = await readFormDataWithinLimit(request, LIMIT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.get("photoKey")).toBe("k1");
    const photo = result.value.get("photo") as File;
    expect(photo.name).toBe("r.jpg");
    expect(await photo.text()).toBe("jpeg");
  });

  // The gap the multipart routes had: a chunked upload declares no length, so the header check
  // passed it and request.formData() buffered the whole thing.
  it("refuses an oversized multipart body that declares no content-length", async () => {
    const request = chunkedMultipart([{ name: "padding", value: "x".repeat(LIMIT * 4) }]);
    const result = await readFormDataWithinLimit(request, LIMIT);
    expect(result.ok).toBe(false);
  });
});
