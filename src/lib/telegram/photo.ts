import type { TelegramMessage, TelegramPhotoSize } from "@/lib/telegram/allowlist";
import { MAX_FILE_SIZE } from "@/lib/receipt-limits";

/** Re-exported so the bot refuses an oversized image in chat, with a reason, rather than after a
 *  download and without ever reserving a credit. Same number the scan pipeline enforces. */
export const MAX_IMAGE_BYTES = MAX_FILE_SIZE;

/** Matches ALLOWED_TYPES in receipt-guard. Anything else is refused before it costs a scan. */
const SCANNABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/**
 * The biggest variant Telegram offered.
 *
 * `file_size` is optional on `PhotoSize`, and comparing on it alone is wrong in a way that costs
 * money: when it is absent every variant scores zero, `reduce` keeps the first, and the first is
 * the smallest thumbnail. A 90x67 crop then goes to OCR, produces nothing usable, and still
 * spends one of the user's scans.
 *
 * Pixel area is the better signal anyway, since it is what OCR actually depends on. Byte size is
 * kept as a tiebreak for variants of equal dimensions, and the documented ascending order is the
 * last resort when a variant carries neither.
 */
const pickLargestSize = (sizes: TelegramPhotoSize[]): TelegramPhotoSize => {
  const area = (p: TelegramPhotoSize) => (p.width ?? 0) * (p.height ?? 0);
  const bytes = (p: TelegramPhotoSize) => p.file_size ?? 0;

  // Seeded with the last element rather than the first: Telegram documents these as ascending,
  // so it is the best guess when nothing can be compared.
  return sizes.reduce((best, next) => {
    if (area(next) !== area(best)) return area(next) > area(best) ? next : best;
    return bytes(next) > bytes(best) ? next : best;
  }, sizes[sizes.length - 1]);
};

export type PhotoPick =
  | { kind: "none" }
  | { kind: "unsupported"; mimeType: string }
  | { kind: "too_large"; bytes: number }
  | { kind: "ok"; fileId: string; mimeType: string; declaredBytes: number | null };

/**
 * Decide what, if anything, to scan from an incoming message.
 *
 * Telegram delivers an image two ways and they are not equivalent. `photo` has been recompressed
 * by Telegram, sometimes hard enough to cost OCR accuracy on small print; `document` is whatever
 * the user sent, which is why sending a receipt "as a file" reads better. Both are supported, and
 * a document wins when a message somehow carries both.
 *
 * `photo` carries no mime type because Telegram has already normalised it to JPEG.
 */
export const pickReceiptImage = (message: TelegramMessage): PhotoPick => {
  const doc = message.document;
  if (doc) {
    const mimeType = doc.mime_type ?? "";
    if (!SCANNABLE.has(mimeType)) return { kind: "unsupported", mimeType };
    if ((doc.file_size ?? 0) > MAX_IMAGE_BYTES) {
      return { kind: "too_large", bytes: doc.file_size ?? 0 };
    }
    return { kind: "ok", fileId: doc.file_id, mimeType, declaredBytes: doc.file_size ?? null };
  }

  const sizes = message.photo;
  if (!sizes?.length) return { kind: "none" };

  const largest = pickLargestSize(sizes);
  if ((largest.file_size ?? 0) > MAX_IMAGE_BYTES) {
    return { kind: "too_large", bytes: largest.file_size ?? 0 };
  }

  return {
    kind: "ok",
    fileId: largest.file_id,
    mimeType: "image/jpeg",
    declaredBytes: largest.file_size ?? null,
  };
};
