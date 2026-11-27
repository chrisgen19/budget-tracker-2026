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

/**
 * AVIF encoder effort (0-9). Measured on the same photos: effort 2 gives the same size as the
 * default 4 (about 60 KB) and the same legibility, at about a fifth of the CPU (155 ms against
 * 1,170 ms on one thread). Higher efforts saved nothing, and uploads encode inside the request,
 * up to three at a time from a multi-scan save.
 */
export const STORED_PHOTO_EFFORT = 2;

const EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** File extension for a stored photo's content type. Unknown types fall back to `jpg`. */
export const photoFileExtension = (contentType: string): string =>
  EXTENSIONS[contentType] ?? "jpg";
