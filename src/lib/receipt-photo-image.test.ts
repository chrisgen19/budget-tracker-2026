// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_DIMENSION } from "./receipt-limits";
import { UnreadableImageError, normaliseReceiptPhoto } from "./receipt-photo-image";

/** A JPEG with EXIF (including a GPS IFD) and an orientation tag, built in-test. */
const makePhotoJpeg = async (): Promise<Uint8Array> => {
  const buffer = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .withExif({
      IFD0: { Make: "TestCam", Model: "Phone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "14/1 35/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  return new Uint8Array(buffer);
};

describe("normaliseReceiptPhoto", () => {
  it("scales a large photo to the max dimension, upright, with all metadata stripped", async () => {
    const input = await makePhotoJpeg();
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.exif).toBeDefined();

    const result = await normaliseReceiptPhoto(input);

    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
    expect(result.width).toBeLessThan(result.height);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(1500);

    const outMeta = await sharp(result.bytes).metadata();
    expect(outMeta.format).toBe("jpeg");
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.icc).toBeUndefined();
    expect(outMeta.xmp).toBeUndefined();
  });

  it("re-encodes a small PNG as JPEG without enlarging it", async () => {
    const png = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const result = await normaliseReceiptPhoto(new Uint8Array(png));

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    const outMeta = await sharp(result.bytes).metadata();
    expect(outMeta.format).toBe("jpeg");
    expect(outMeta.width).toBe(800);
    expect(outMeta.height).toBe(600);
  });

  it("rejects bytes that are not an image with UnreadableImageError", async () => {
    await expect(normaliseReceiptPhoto(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(
      UnreadableImageError,
    );
  });
});
