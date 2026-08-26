import type { TelegramMessage } from "@/lib/telegram/allowlist";

/** Matches ALLOWED_TYPES in receipt-guard. Anything else is refused before it costs a scan. */
const SCANNABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/** The scan pipeline's own ceiling. Checked here too so an oversized photo is refused in chat,
 *  with a reason, rather than after a download. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

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

  // Ascending by size, but not guaranteed to be, so pick the largest explicitly rather than
  // trusting the order.
  const largest = sizes.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a));
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
