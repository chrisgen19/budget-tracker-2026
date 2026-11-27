/**
 * Client-safe HEIC/HEIF detection. `receipt-guard.ts` pulls in Prisma, so the browser cannot
 * import its `resolveMimeType`; this applies the same rule (reported type, else extension).
 */

/** Shown when a browser could not convert a HEIC photo to JPEG and the file is still HEIC. */
export const HEIC_UNSUPPORTED_FIELD_MESSAGE =
  "This browser can't convert HEIC photos. Attach a JPEG, or attach it from your phone.";
export const HEIC_UNSUPPORTED_SCAN_MESSAGE =
  "Saved. This browser can't convert HEIC photos, so the photo wasn't kept.";

const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

/** True when the file is HEIC/HEIF by its reported type or, when that is blank, its extension. */
export const isHeicFile = (file: File): boolean => {
  if (HEIC_TYPES.has(file.type.toLowerCase())) return true;
  if (file.type && file.type !== "application/octet-stream") return false;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return HEIC_EXTENSIONS.has(ext);
};

const HEIF_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1",
]);

/** True when the bytes open with an ISO-BMFF `ftyp` box naming a HEIF brand. */
export const looksLikeHeicBytes = (bytes: Uint8Array): boolean => {
  if (bytes.length < 12) return false;
  const text = (from: number) => String.fromCharCode(...bytes.slice(from, from + 4));
  return text(4) === "ftyp" && HEIF_BRANDS.has(text(8));
};
