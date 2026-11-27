import { describe, expect, it, vi } from "vitest";
import {
  PhotoNotFoundError,
  PhotoStorageError,
  PhotosDisabledError,
  createPhotoStorage,
  photoObjectKey,
  receiptPhotosEnabled,
} from "./receipt-photo-storage";

const ENV = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
} as unknown as NodeJS.ProcessEnv;

function stub(status: number) {
  const calls: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(input instanceof Request ? input : new Request(input, init));
    return new Response(status === 200 ? "bytes" : null, { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("receiptPhotosEnabled", () => {
  it("is true when all four are set", () => {
    expect(receiptPhotosEnabled(ENV)).toBe(true);
  });
  it.each(Object.keys(ENV))("is false when %s is missing, empty or blank", (name) => {
    expect(receiptPhotosEnabled({ ...ENV, [name]: undefined })).toBe(false);
    expect(receiptPhotosEnabled({ ...ENV, [name]: "" })).toBe(false);
    expect(receiptPhotosEnabled({ ...ENV, [name]: "  " })).toBe(false);
  });
});

describe("photoObjectKey", () => {
  it("builds the key with the stored format's extension", () => {
    expect(photoObjectKey("u1", "p1", "image/avif")).toBe("receipts/u1/p1.avif");
    expect(photoObjectKey("u1", "p1", "image/jpeg")).toBe("receipts/u1/p1.jpg");
  });
});

describe("createPhotoStorage", () => {
  it("throws when disabled", () => {
    expect(() => createPhotoStorage({} as NodeJS.ProcessEnv)).toThrow(PhotosDisabledError);
  });

  it("put sends a signed PUT", async () => {
    const { calls, fetchImpl } = stub(200);
    await createPhotoStorage(ENV, fetchImpl).put(
      "receipts/u1/p1.jpg",
      new Uint8Array([1, 2]),
      "image/jpeg",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe("https://acct.r2.cloudflarestorage.com/bucket/receipts/u1/p1.jpg");
    expect(calls[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/);
    expect(calls[0].headers.get("content-type")).toBe("image/jpeg");
  });

  it("put hands fetch the raw bytes, not a signed Request, so Content-Length survives", async () => {
    // Next's patched fetch rebuilds a Request input from its body stream, which has no length:
    // the PUT then went out chunked and R2 answered 411 Length Required. A Uint8Array passed
    // as init.body keeps its length through that rebuild.
    const seen: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ input, init });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await createPhotoStorage(ENV, fetchImpl).put("receipts/u1/p1.jpg", bytes, "image/jpeg");

    expect(seen).toHaveLength(1);
    expect(seen[0].input).not.toBeInstanceOf(Request);
    expect(String(seen[0].input)).toBe(
      "https://acct.r2.cloudflarestorage.com/bucket/receipts/u1/p1.jpg",
    );
    expect(seen[0].init?.body).toBe(bytes);
    // Still signed. The payload is not part of the signature (S3 UNSIGNED-PAYLOAD), so sending
    // the bytes separately from the signed Request cannot invalidate it.
    const headers = new Headers(seen[0].init?.headers);
    expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/);
    expect(headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD");
    expect(headers.get("content-type")).toBe("image/jpeg");
  });

  it("put throws PhotoStorageError on failure", async () => {
    const { fetchImpl } = stub(500);
    await expect(
      createPhotoStorage(ENV, fetchImpl).put("k", new Uint8Array(), "image/jpeg"),
    ).rejects.toThrow(PhotoStorageError);
  });

  it("get returns the response on 200", async () => {
    const { calls, fetchImpl } = stub(200);
    const res = await createPhotoStorage(ENV, fetchImpl).get("k");
    expect(await res.text()).toBe("bytes");
    expect(calls[0].method).toBe("GET");
  });

  it("get maps 404 and other errors", async () => {
    await expect(createPhotoStorage(ENV, stub(404).fetchImpl).get("k")).rejects.toThrow(
      PhotoNotFoundError,
    );
    await expect(createPhotoStorage(ENV, stub(500).fetchImpl).get("k")).rejects.toThrow(
      PhotoStorageError,
    );
  });

  it("delete treats 404 as success and 500 as error", async () => {
    const { calls, fetchImpl } = stub(404);
    await expect(createPhotoStorage(ENV, fetchImpl).delete("k")).resolves.toBeUndefined();
    expect(calls[0].method).toBe("DELETE");
    await expect(createPhotoStorage(ENV, stub(500).fetchImpl).delete("k")).rejects.toThrow(
      PhotoStorageError,
    );
  });
});

describe("createPhotoStorage list", () => {
  const page = (keys: { key: string; modified: string }[], next?: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>bucket</Name>
  <IsTruncated>${next ? "true" : "false"}</IsTruncated>
  ${keys
    .map(
      (k) =>
        `<Contents><Key>${k.key}</Key><LastModified>${k.modified}</LastModified><Size>3</Size></Contents>`,
    )
    .join("")}
  ${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}
</ListBucketResult>`;

  const pagedFetch = (pages: string[]) => {
    const calls: Request[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(input instanceof Request ? input : new Request(input, init));
      return new Response(pages[calls.length - 1] ?? "", { status: 200 });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };

  it("sends a signed ListObjectsV2 for the prefix", async () => {
    const { calls, fetchImpl } = pagedFetch([page([])]);
    await createPhotoStorage(ENV, fetchImpl).list("receipts/");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe("https://acct.r2.cloudflarestorage.com/bucket");
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("prefix")).toBe("receipts/");
    expect(url.searchParams.has("continuation-token")).toBe(false);
    expect(calls[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/);
  });

  it("returns every key with its last-modified time", async () => {
    const { fetchImpl } = pagedFetch([
      page([
        { key: "receipts/u1/p1.jpg", modified: "2026-11-01T00:00:00.000Z" },
        { key: "receipts/u2/p2.jpg", modified: "2026-11-02T00:00:00.000Z" },
      ]),
    ]);
    expect(await createPhotoStorage(ENV, fetchImpl).list("receipts/")).toEqual([
      { key: "receipts/u1/p1.jpg", lastModified: new Date("2026-11-01T00:00:00.000Z") },
      { key: "receipts/u2/p2.jpg", lastModified: new Date("2026-11-02T00:00:00.000Z") },
    ]);
  });

  it("follows continuation tokens until the listing is complete", async () => {
    const { calls, fetchImpl } = pagedFetch([
      page([{ key: "receipts/a.jpg", modified: "2026-11-01T00:00:00Z" }], "tok/1+="),
      page([{ key: "receipts/b.jpg", modified: "2026-11-01T00:00:00Z" }]),
    ]);
    const objects = await createPhotoStorage(ENV, fetchImpl).list("receipts/");
    expect(objects.map((o) => o.key)).toEqual(["receipts/a.jpg", "receipts/b.jpg"]);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("continuation-token")).toBe("tok/1+=");
  });

  it("decodes XML entities in keys", async () => {
    const { fetchImpl } = pagedFetch([
      page([{ key: "receipts/a&amp;b&lt;c&#39;.jpg", modified: "2026-11-01T00:00:00Z" }]),
    ]);
    const [object] = await createPhotoStorage(ENV, fetchImpl).list("receipts/");
    expect(object.key).toBe("receipts/a&b<c'.jpg");
  });

  it("throws PhotoStorageError on a failed page", async () => {
    await expect(createPhotoStorage(ENV, stub(403).fetchImpl).list("receipts/")).rejects.toThrow(
      PhotoStorageError,
    );
  });

  it("refuses a truncated page with no continuation token rather than looping", async () => {
    const broken = page([]).replace("<IsTruncated>false", "<IsTruncated>true");
    const { fetchImpl } = pagedFetch([broken]);
    await expect(createPhotoStorage(ENV, fetchImpl).list("receipts/")).rejects.toThrow(
      PhotoStorageError,
    );
  });
});

describe("request timeout", () => {
  it("gives up on a request that hangs for 10 seconds, as a PhotoStorageError", async () => {
    vi.useFakeTimers();
    try {
      const hung = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const signal = (init?.signal ?? (input as Request).signal) as AbortSignal;
        return new Promise<Response>((_, reject) => {
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      }) as typeof fetch;
      const pending = createPhotoStorage(ENV, hung).delete("k");
      const settled = expect(pending).rejects.toThrow(PhotoStorageError);
      await vi.advanceTimersByTimeAsync(10_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["TimeoutError", "AbortError"])("maps a %s to PhotoStorageError", async (name) => {
    const fetchImpl = (async () => {
      throw new DOMException("The operation timed out.", name);
    }) as unknown as typeof fetch;
    const storage = createPhotoStorage(ENV, fetchImpl);

    await expect(storage.put("k", new Uint8Array(), "image/jpeg")).rejects.toThrow(PhotoStorageError);
    await expect(storage.get("k")).rejects.toThrow(PhotoStorageError);
    await expect(storage.delete("k")).rejects.toThrow(PhotoStorageError);
    await expect(storage.list("receipts/")).rejects.toThrow(PhotoStorageError);
  });
});
