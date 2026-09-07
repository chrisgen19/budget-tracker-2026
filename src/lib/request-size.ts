import { NextResponse } from "next/server";

/**
 * Byte ceilings on request bodies, and the only two ways to enforce one.
 *
 * A module with no imports beyond `next/server`, for the reason `receipt-limits.ts` has none:
 * `receipt-guard.ts` — where `checkBodySize` used to live alone — pulls in the Prisma singleton
 * and the scan-quota layer, so any route wanting a size ceiling had to take a database client
 * with it. That is most of why `POST /api/transactions/batch` never got one (#138).
 *
 * The two halves are not redundant. `overBodySizeLimit` reads `content-length`, which is a
 * *claim*: it is absent on a chunked request and can simply be wrong. It earns its place by
 * refusing an honest oversized client before a single byte is buffered. `readJsonWithinLimit`
 * is what actually enforces, by counting the bytes it reads and stopping.
 */

/** Reject a declared body size before anything reads the stream. */
export const overBodySizeLimit = (request: Request, limit: number): boolean => {
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  return Number.isFinite(declaredLength) && declaredLength > limit;
};

/** Where the coalescing buffer starts before it doubles. Most bodies here never outgrow it. */
const INITIAL_BUFFER_BYTES = 64 * 1024;

/**
 * Read and parse a JSON body, refusing once more than `limit` bytes have arrived.
 *
 * `request.json()` buffers the whole body first and asks questions later, so a `content-length`
 * check in front of it is the entire guard — and a request that sends no `content-length` skips
 * it. Counting as we go closes that, and cancels the stream at the limit rather than draining a
 * body we have already decided to refuse.
 *
 * Bytes are copied into one growing buffer rather than accumulated as a list of chunks. The
 * distinction is not tidiness: a stream delivers one chunk object per *HTTP* chunk, which the
 * sender chooses, so a 4 MB body split into 64-byte chunks arrives as 65,536 live `Uint8Array`s
 * and measured 36 MB of heap against 16 MB coalesced. A byte ceiling alone does not bound that,
 * because the ratio of allocations to bytes is the caller's to pick. Note this is exactly what
 * undici's own `readAllBytes` does behind `request.json()` (`bytes.push(chunk)`, then
 * `Buffer.concat`), and it applies no ceiling at all — so this is the pre-existing shape being
 * improved on, not a hazard introduced by metering. Coalescing also halves peak memory in the
 * ordinary case, where holding every chunk *and* the assembled copy was the real cost.
 *
 * `ok: false` means "too large" and nothing else. A malformed body still throws `SyntaxError`
 * out of `JSON.parse`, exactly as `request.json()` did, so callers' existing catch blocks keep
 * classifying it the way they always have.
 */
export async function readJsonWithinLimit(
  request: Request,
  limit: number,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  if (overBodySizeLimit(request, limit)) return { ok: false };

  const body = request.body;
  // No stream to meter — an empty body, or a Request built without one. Fall back to the
  // built-in read: there is nothing here to be large.
  if (!body) return { ok: true, value: await request.json() };

  const reader = body.getReader();
  let buffer = new Uint8Array(Math.min(limit, INITIAL_BUFFER_BYTES));
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    // Checked before the copy, so an oversized body is never written anywhere.
    if (total + value.byteLength > limit) {
      await reader.cancel();
      return { ok: false };
    }

    if (total + value.byteLength > buffer.byteLength) {
      const grown = new Uint8Array(
        Math.min(limit, Math.max(buffer.byteLength * 2, total + value.byteLength)),
      );
      grown.set(buffer.subarray(0, total));
      buffer = grown;
    }

    buffer.set(value, total);
    total += value.byteLength;
  }

  return { ok: true, value: JSON.parse(new TextDecoder().decode(buffer.subarray(0, total))) };
}

/**
 * The 413 the batch verbs return.
 *
 * Deliberately not the receipt wording ("File too large. Maximum size is 4 MB."): nobody
 * uploading a file is looking at this, and the action that shrinks the body is saving fewer
 * receipts at once.
 */
export const bodyTooLargeResponse = (): NextResponse =>
  NextResponse.json(
    { error: "That save is too large. Please save fewer receipts at once.", code: "BODY_TOO_LARGE" },
    { status: 413 },
  );
