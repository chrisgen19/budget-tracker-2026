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

/**
 * Read and parse a JSON body, refusing once more than `limit` bytes have arrived.
 *
 * `request.json()` buffers the whole body first and asks questions later, so a `content-length`
 * check in front of it is the entire guard — and a request that sends no `content-length` skips
 * it. Counting as we go closes that, and cancels the stream at the limit rather than draining a
 * body we have already decided to refuse.
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
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, value: JSON.parse(new TextDecoder().decode(buffer)) };
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
