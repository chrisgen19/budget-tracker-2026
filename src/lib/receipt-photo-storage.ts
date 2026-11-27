/**
 * Cloudflare R2 storage for receipt photos (S3 API, signed with aws4fetch).
 *
 * Server-only: reads secret R2 credentials. Never import from client code.
 */
import { AwsClient } from "aws4fetch";

const REQUIRED_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

/** Longest a single R2 request may take before it is abandoned. */
const STORAGE_TIMEOUT_MS = 10_000;

export class PhotosDisabledError extends Error {
  constructor() {
    super("Receipt photos are not configured");
    this.name = "PhotosDisabledError";
  }
}

export class PhotoNotFoundError extends Error {
  constructor(key: string) {
    super(`Receipt photo not found: ${key}`);
    this.name = "PhotoNotFoundError";
  }
}

export class PhotoStorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PhotoStorageError";
  }
}

export interface PhotoStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Returns the unread Response so a route can stream the body. */
  get(key: string): Promise<Response>;
  /** Idempotent: a missing object counts as deleted. */
  delete(key: string): Promise<void>;
  /**
   * Every object under `prefix`, following continuation tokens to the end. Carries each object's
   * last-modified time so a sweep can leave alone an object whose row is still being written.
   */
  list(prefix: string): Promise<StoredObject[]>;
}

export interface StoredObject {
  key: string;
  lastModified: Date;
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decodeXml = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES[entity] ?? match;
  });

const firstTag = (xml: string, tag: string): string | null => {
  const found = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return found ? decodeXml(found[1]) : null;
};

/**
 * One ListObjectsV2 page, parsed with regexes rather than a DOM parser (none exists in Node, and
 * the response shape is fixed). Throws when a page claims to be truncated but names no token,
 * since following it would loop on the first page for ever.
 */
const parseListPage = (xml: string): { objects: StoredObject[]; next: string | null } => {
  const objects: StoredObject[] = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = firstTag(match[1], "Key");
    const modified = firstTag(match[1], "LastModified");
    if (key === null || modified === null) continue;
    objects.push({ key, lastModified: new Date(modified) });
  }
  const truncated = firstTag(xml, "IsTruncated") === "true";
  const next = firstTag(xml, "NextContinuationToken");
  if (truncated && !next) {
    throw new PhotoStorageError("R2 LIST returned a truncated page with no continuation token");
  }
  return { objects, next: truncated ? next : null };
};

const readVar = (env: NodeJS.ProcessEnv, name: string): string => env[name]?.trim() ?? "";

/** True only when all four R2 variables are set; blank counts as unset. */
export const receiptPhotosEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  REQUIRED_VARS.every((name) => readVar(env, name) !== "");

/** Object key for a photo. Never derived from a description or amount. */
export const photoObjectKey = (userId: string, photoId: string): string =>
  `receipts/${userId}/${photoId}.jpg`;

export function createPhotoStorage(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): PhotoStorage {
  if (!receiptPhotosEnabled(env)) throw new PhotosDisabledError();

  const client = new AwsClient({
    accessKeyId: readVar(env, "R2_ACCESS_KEY_ID"),
    secretAccessKey: readVar(env, "R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
  const base = `https://${readVar(env, "R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${readVar(env, "R2_BUCKET")}`;

  const sendTo = async (method: string, url: string, init: RequestInit = {}): Promise<Response> => {
    // Aborts a hung request: cleanup is awaited on PUT and DELETE request paths, so an
    // unresponsive bucket would otherwise stall the user's edit. Covers the wait for headers.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new DOMException("R2 request timed out", "TimeoutError")),
      STORAGE_TIMEOUT_MS,
    );
    try {
      // Sign, then send the ORIGINAL body rather than the signed Request. Next's patched fetch
      // rebuilds a Request input from `request.body`, which is a stream of unknown length, so
      // the PUT went out chunked with no Content-Length and R2 answered 411. A Uint8Array in
      // `init.body` survives that rebuild with its length. The signature is unaffected: for S3,
      // aws4fetch signs the URL and headers with `X-Amz-Content-Sha256: UNSIGNED-PAYLOAD`.
      const signed = await client.sign(url, { ...init, method });
      return await fetchImpl(signed.url, {
        method,
        headers: signed.headers,
        body: init.body,
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new PhotoStorageError(
        timedOut
          ? `R2 ${method} timed out after ${STORAGE_TIMEOUT_MS} ms`
          : `R2 ${method} failed: ${error instanceof Error ? error.message : "network error"}`,
      );
    } finally {
      clearTimeout(timer);
    }
  };
  const send = (method: string, key: string, init: RequestInit = {}): Promise<Response> =>
    sendTo(method, `${base}/${key}`, init);

  return {
    async put(key, body, contentType) {
      const res = await send("PUT", key, {
        body: body as BodyInit,
        headers: { "content-type": contentType },
      });
      if (!res.ok) throw new PhotoStorageError(`R2 PUT returned ${res.status}`, res.status);
    },
    async get(key) {
      const res = await send("GET", key);
      if (res.status === 404) throw new PhotoNotFoundError(key);
      if (!res.ok) throw new PhotoStorageError(`R2 GET returned ${res.status}`, res.status);
      return res;
    },
    async delete(key) {
      const res = await send("DELETE", key);
      if (!res.ok && res.status !== 404) {
        throw new PhotoStorageError(`R2 DELETE returned ${res.status}`, res.status);
      }
    },
    async list(prefix) {
      const objects: StoredObject[] = [];
      let token: string | null = null;
      do {
        const query = new URLSearchParams({ "list-type": "2", prefix });
        if (token) query.set("continuation-token", token);
        const res = await sendTo("GET", `${base}?${query.toString()}`);
        if (!res.ok) throw new PhotoStorageError(`R2 LIST returned ${res.status}`, res.status);
        const parsed = parseListPage(await res.text());
        objects.push(...parsed.objects);
        token = parsed.next;
      } while (token);
      return objects;
    },
  };
}
