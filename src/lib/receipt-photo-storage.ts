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
}

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

  const send = async (method: string, key: string, init: RequestInit = {}): Promise<Response> => {
    const signed = await client.sign(`${base}/${key}`, { ...init, method });
    try {
      return await fetchImpl(signed);
    } catch (error) {
      throw new PhotoStorageError(
        `R2 ${method} failed: ${error instanceof Error ? error.message : "network error"}`,
      );
    }
  };

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
  };
}
