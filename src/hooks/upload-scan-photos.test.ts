import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRefusedError } from "@/hooks/api-error";
import { photoIdsByReceipt, planScanPhotos, uploadScanPhotos } from "@/hooks/upload-scan-photos";
import type { MultiScanItem } from "@/types";

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock("@/hooks/use-receipt-photos", () => ({
  uploadReceiptPhoto: (file: File, photoKey: string) => uploadMock(file, photoKey),
}));

const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });

const row = (id: string, imageFile?: File, receiptGroupId?: string): MultiScanItem => ({
  id,
  fileName: imageFile?.name ?? id,
  status: "success",
  imageFile,
  data: { amount: 1, description: id, type: "EXPENSE", categoryId: "c", receiptGroupId },
});

const photoView = (id: string) => ({ id, width: 1, height: 1, byteSize: 1, createdAt: "" });

beforeEach(() => {
  uploadMock.mockReset();
});

describe("planScanPhotos", () => {
  it("plans one photo per receipt: split rows share their group, a single row is its own", () => {
    const a = file("a.jpg");
    const b = file("b.jpg");
    const photos = planScanPhotos([row("a-0", a, "g1"), row("a-1", a, "g1"), row("b", b)]);

    expect(photos.map((p) => [p.receiptKey, p.file.name])).toEqual([
      ["g1", "a.jpg"],
      ["b", "b.jpg"],
    ]);
    expect(new Set(photos.map((p) => p.photoKey)).size).toBe(2);
    expect(photos.every((p) => p.photoId === undefined)).toBe(true);
  });

  it("skips a row that holds no image", () => {
    expect(planScanPhotos([row("x")])).toEqual([]);
  });
});

describe("uploadScanPhotos", () => {
  it("never has more than 3 uploads in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    uploadMock.mockImplementation(async (f: File) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return photoView(`p-${f.name}`);
    });
    const photos = planScanPhotos(
      Array.from({ length: 7 }, (_, i) => row(`r${i}`, file(`${i}.jpg`))),
    );

    const uploaded = await uploadScanPhotos(photos);

    expect(uploadMock).toHaveBeenCalledTimes(7);
    expect(peak).toBe(3);
    expect(uploaded.map((p) => p.photoId)).toEqual(photos.map((p) => `p-${p.file.name}`));
  });

  it("drops only the failed receipt's photo and does not reject", async () => {
    uploadMock.mockImplementation(async (f: File) => {
      if (f.name === "bad.jpg") throw new ApiRefusedError("Failed to upload photo", 500);
      return photoView(`p-${f.name}`);
    });
    const photos = planScanPhotos([row("ok", file("ok.jpg")), row("bad", file("bad.jpg"))]);

    const uploaded = await uploadScanPhotos(photos);

    expect(uploaded.map((p) => p.photoId)).toEqual(["p-ok.jpg", undefined]);
    expect(photoIdsByReceipt(uploaded)).toEqual(new Map([["ok", "p-ok.jpg"]]));
  });

  it("skips an uploaded receipt and retries a failed one under the same key", async () => {
    uploadMock
      .mockResolvedValueOnce(photoView("p-ok"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const photos = planScanPhotos([row("ok", file("ok.jpg")), row("bad", file("bad.jpg"))]);
    const first = await uploadScanPhotos(photos);

    uploadMock.mockResolvedValueOnce(photoView("p-bad"));
    const second = await uploadScanPhotos(first);

    expect(uploadMock).toHaveBeenCalledTimes(3);
    expect(uploadMock.mock.calls[2]).toEqual([photos[1].file, photos[1].photoKey]);
    expect(second.map((p) => p.photoId)).toEqual(["p-ok", "p-bad"]);
    // The input is not mutated, so a caller decides when the results become the pin.
    expect(photos.every((p) => p.photoId === undefined)).toBe(true);
  });
});
