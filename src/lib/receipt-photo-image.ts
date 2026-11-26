import sharp from "sharp";
import { MAX_IMAGE_DIMENSION } from "./receipt-limits";

/** Thrown when the bytes are not an image `sharp` can decode. Routes answer 422 for it. */
export class UnreadableImageError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The file is not a readable image.", options);
    this.name = "UnreadableImageError";
  }
}

export interface NormalisedReceiptPhoto {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Re-encodes a receipt photo for storage: upright, JPEG at quality 80, longest side capped at
 * `MAX_IMAGE_DIMENSION` and never enlarged, with every metadata block dropped (EXIF, including
 * GPS, ICC and XMP).
 *
 * Metadata is stripped by omission: `sharp` only keeps it when `withMetadata` is called, so this
 * must not call it.
 *
 * @throws {UnreadableImageError} when `sharp` cannot decode the input.
 */
export const normaliseReceiptPhoto = async (
  input: Uint8Array,
): Promise<NormalisedReceiptPhoto> => {
  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    output = await sharp(input)
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new UnreadableImageError({ cause: error });
  }

  return {
    bytes: new Uint8Array(output.data),
    width: output.info.width,
    height: output.info.height,
  };
};
