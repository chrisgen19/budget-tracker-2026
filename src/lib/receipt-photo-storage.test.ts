import { describe, expect, it } from "vitest";
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
  it("builds the key", () => {
    expect(photoObjectKey("u1", "p1")).toBe("receipts/u1/p1.jpg");
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
