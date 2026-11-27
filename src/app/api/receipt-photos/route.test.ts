// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  enabled: vi.fn(),
  put: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/prisma", () => ({
  prisma: { receiptPhoto: { findUnique: mocks.findUnique, create: mocks.create } },
}));
vi.mock("@/lib/receipt-photo-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipt-photo-storage")>()),
  receiptPhotosEnabled: mocks.enabled,
  createPhotoStorage: () => ({ put: mocks.put, get: vi.fn(), delete: vi.fn() }),
}));

import { POST } from "@/app/api/receipt-photos/route";
import { PhotoStorageError } from "@/lib/receipt-photo-storage";

const KEY = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

const post = (file: File | null, photoKey: string | null = KEY) => {
  const form = new FormData();
  if (file) form.set("photo", file);
  if (photoKey !== null) form.set("photoKey", photoKey);
  return POST(new Request("http://localhost/api/receipt-photos", { method: "POST", body: form }));
};

const jpeg = (bytes: Uint8Array = new Uint8Array([1, 2, 3])) =>
  new File([bytes as BlobPart], "r.jpg", { type: "image/jpeg" });

describe("POST /api/receipt-photos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.enabled.mockReturnValue(true);
    mocks.findUnique.mockResolvedValue(null);
  });

  it("401 without a session", async () => {
    mocks.getAuthUserId.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await post(jpeg())).status).toBe(401);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("503 PHOTOS_DISABLED when R2 is not configured", async () => {
    mocks.enabled.mockReturnValue(false);
    const res = await post(jpeg());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("PHOTOS_DISABLED");
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("415 for a PDF", async () => {
    const res = await post(new File([new Uint8Array([1])], "r.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(415);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("413 over MAX_FILE_SIZE", async () => {
    const res = await post(jpeg(new Uint8Array(4 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("413 when the content-length header is over the body ceiling", async () => {
    const form = new FormData();
    form.set("photo", jpeg());
    const res = await POST(
      new Request("http://localhost/api/receipt-photos", {
        method: "POST",
        body: form,
        headers: { "content-length": String(6 * 1024 * 1024) },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("422 for undecodable bytes", async () => {
    const res = await post(jpeg(new Uint8Array([1, 2, 3, 4])));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "That file isn't a readable image." });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("415 for a HEIC upload sharp cannot decode, by declared type", async () => {
    const res = await post(new File([new Uint8Array([1, 2, 3, 4])], "r.heic", { type: "image/heic" }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "HEIC photos aren't supported. Send a JPEG or PNG." });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("415 for HEIC bytes mislabelled as a JPEG", async () => {
    const bytes = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    expect((await post(jpeg(bytes))).status).toBe(415);
  });

  it("400 for a missing or non-UUID photoKey", async () => {
    expect((await post(jpeg(), null)).status).toBe(400);
    expect((await post(jpeg(), "not-a-uuid")).status).toBe(400);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("400 for a missing photo", async () => {
    expect((await post(null)).status).toBe(400);
  });

  // A 502 used to leave nothing in the server log, so a refused token, a missing bucket and a
  // passing R2 blip all looked the same. The client still gets the generic message.
  it("502 when storage refuses, logging R2's reason for the server only", async () => {
    const sharp = (await import("sharp")).default;
    const real = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    mocks.put.mockRejectedValue(new PhotoStorageError("R2 PUT returned 403", 403));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await post(jpeg(new Uint8Array(real)));

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Photo storage failed." });
      expect(warn).toHaveBeenCalledWith("[receipt-photos] upload failed in storage:", "R2 PUT returned 403");
    } finally {
      warn.mockRestore();
    }
  });

  // A sharp build that cannot encode AVIF throws a plain Error after a good decode. It used to be
  // folded into UnreadableImageError and answered 422, blaming the user's photo with no log line.
  it("500 for an unexpected failure, logged, never reported as an unreadable photo", async () => {
    const sharp = (await import("sharp")).default;
    const real = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    mocks.put.mockRejectedValue(new Error("heif: Unsupported feature: No codec for AV1"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await post(jpeg(new Uint8Array(real)));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to save the photo." });
      expect(error).toHaveBeenCalledWith("[receipt-photos] upload failed:", expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });

  it("200 on a replay of the same photoKey without storing again", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "p1", width: 1, height: 1, byteSize: 1, createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const res = await post(jpeg());
    expect(res.status).toBe(200);
    expect((await res.json()).photo.id).toBe("p1");
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
