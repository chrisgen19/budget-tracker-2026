import sharp from "sharp";
import { STORED_PHOTO_MAX_DIMENSION } from "./receipt-limits";
import {
  STORED_PHOTO_CONTENT_TYPE,
  STORED_PHOTO_EFFORT,
  STORED_PHOTO_QUALITY,
} from "./receipt-photo-format";

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
  /** MIME type of `bytes`, stored on the row and served back as `content-type`. */
  contentType: string;
}

/**
 * Re-encodes a receipt photo for storage: upright, AVIF at `STORED_PHOTO_QUALITY`, longest side
 * capped at `STORED_PHOTO_MAX_DIMENSION` and never enlarged, with every metadata block dropped
 * (EXIF, including GPS, ICC and XMP).
 *
 * Decoding and encoding are two steps on purpose. Only a decode failure means the upload is bad
 * (`UnreadableImageError`, 422); an encode failure means this server's sharp cannot write AVIF,
 * and must surface as a server error rather than tell the user their photo is unreadable.
 *
 * Metadata is stripped by omission: `sharp` only keeps it when `withMetadata` is called, so this
 * must not call it. The raw intermediate carries no metadata at all.
 *
 * @throws {UnreadableImageError} when `sharp` cannot decode the input.
 */
export const normaliseReceiptPhoto = async (
  input: Uint8Array,
): Promise<NormalisedReceiptPhoto> => {
  let decoded: { data: Buffer; info: sharp.OutputInfo };
  try {
    decoded = await sharp(input)
      .rotate()
      .resize({
        width: STORED_PHOTO_MAX_DIMENSION,
        height: STORED_PHOTO_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new UnreadableImageError({ cause: error });
  }

  const { width, height, channels } = decoded.info;
  const encoded = await sharp(decoded.data, { raw: { width, height, channels } })
    .avif({ quality: STORED_PHOTO_QUALITY, effort: STORED_PHOTO_EFFORT })
    .toBuffer();

  return {
    bytes: new Uint8Array(encoded),
    width,
    height,
    contentType: STORED_PHOTO_CONTENT_TYPE,
  };
};
