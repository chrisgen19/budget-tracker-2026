/**
 * The format receipt photos are stored in, in a module with no imports so the client can read it
 * (the download filename) without pulling in `sharp`.
 *
 * AVIF at quality 50 was measured against real production receipt photos: about a quarter of the
 * JPEG q80 size at the same pixel size, with the smallest receipt print still legible zoomed in.
 * Rows written before the switch stay JPEG; each row's `content_type` says which it is.
 */
export const STORED_PHOTO_CONTENT_TYPE = "image/avif";
export const STORED_PHOTO_QUALITY = 50;

const EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** File extension for a stored photo's content type. Unknown types fall back to `jpg`. */
export const photoFileExtension = (contentType: string): string =>
  EXTENSIONS[contentType] ?? "jpg";
