/**
 * When a photo was taken, read from its own EXIF metadata.
 *
 * The Telegram bot has no camera roll to ask, so an unreadable receipt date used to fall back to
 * *today*: photograph a receipt on Monday, send it on Thursday with the date smudged, and the
 * transaction landed on Thursday. The web app never had that problem, because the browser hands
 * it `File.lastModified`. This is the equivalent for bytes that arrived over a chat.
 *
 * Deliberately no dependency. EXIF timestamps are a fixed-width ASCII field inside a TIFF block,
 * and locating one needs a few dozen lines rather than a parser library.
 */

/** ASCII, `YYYY:MM:DD HH:MM:SS`, exactly 19 bytes plus a NUL. */
const EXIF_DATE_LENGTH = 19;

const TAG_DATETIME = 0x0132; // IFD0, when the file was last written
const TAG_EXIF_IFD = 0x8769; // IFD0, pointer to the Exif sub-IFD
const TAG_DATETIME_ORIGINAL = 0x9003; // Exif IFD, when the shutter fired
const TAG_DATETIME_DIGITIZED = 0x9004; // Exif IFD, when it was digitised

interface Reader {
  u16: (offset: number) => number;
  u32: (offset: number) => number;
}

/** Locate the TIFF header both JPEG (APP1) and HEIC (an `Exif` item) embed. */
const findTiffHeader = (buf: Buffer): { start: number; big: boolean } | null => {
  // Anchored on the magic rather than on container structure, which keeps one code path for
  // JPEG, HEIC and anything else that embeds a standard TIFF block. The magic is four bytes and
  // has to be followed by a plausible IFD offset, so a false positive cannot get far.
  for (const [magic, big] of [
    [Buffer.from([0x49, 0x49, 0x2a, 0x00]), false],
    [Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), true],
  ] as const) {
    let from = 0;
    for (;;) {
      const start = buf.indexOf(magic, from);
      if (start < 0) break;
      if (start + 8 <= buf.length) {
        const offset = big ? buf.readUInt32BE(start + 4) : buf.readUInt32LE(start + 4);
        // The first IFD sits after the 8-byte header and inside the buffer.
        if (offset >= 8 && start + offset + 2 <= buf.length) return { start, big };
      }
      from = start + 1;
    }
  }
  return null;
};

/** Read the ASCII value of one tag, if this IFD carries it. */
const readTag = (
  buf: Buffer,
  read: Reader,
  ifd: number,
  tiff: number,
  wanted: number
): string | null => {
  if (ifd + 2 > buf.length) return null;
  const count = read.u16(ifd);
  // A corrupt count could otherwise walk far past the buffer.
  if (count > 512) return null;

  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > buf.length) return null;
    if (read.u16(entry) !== wanted) continue;

    const valueAt = tiff + read.u32(entry + 8);
    if (valueAt + EXIF_DATE_LENGTH > buf.length) return null;
    return buf.toString("ascii", valueAt, valueAt + EXIF_DATE_LENGTH);
  }
  return null;
};

/** Where a pointer tag leads, if this IFD carries one. */
const readPointer = (buf: Buffer, read: Reader, ifd: number, tiff: number, wanted: number) => {
  if (ifd + 2 > buf.length) return null;
  const count = read.u16(ifd);
  if (count > 512) return null;

  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > buf.length) return null;
    if (read.u16(entry) !== wanted) continue;

    const target = tiff + read.u32(entry + 8);
    return target + 2 <= buf.length ? target : null;
  }
  return null;
};

/**
 * `YYYY:MM:DD HH:MM:SS` as the offset-less ISO timestamp the rest of the app speaks.
 *
 * EXIF timestamps carry no timezone by specification: they are already the photographer's wall
 * clock, which is exactly the shape `resolveTransactionDate` wants. Appending a `Z` here would
 * claim UTC and shift the transaction by hours.
 */
const toIsoLocal = (exif: string): string | null => {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(exif.trim());
  if (!m) return null;

  const [, y, mo, d, h, mi, s] = m;
  // A camera with no clock set writes zeroes, which is not a date.
  if (`${y}${mo}${d}` === "00000000") return null;

  const asUtc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  if (
    asUtc.getUTCFullYear() !== +y ||
    asUtc.getUTCMonth() !== +mo - 1 ||
    asUtc.getUTCDate() !== +d ||
    asUtc.getUTCHours() !== +h ||
    asUtc.getUTCMinutes() !== +mi
  ) {
    return null;
  }

  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
};

/**
 * When this image was captured, or null if it does not say.
 *
 * Tries the shutter time first and falls back to the digitisation and file-write times, which is
 * the order of decreasing confidence that this is when the receipt was actually photographed.
 *
 * Returns an offset-less local timestamp, e.g. `2026-08-01T20:05:04`.
 */
export const readPhotoTakenAt = (buf: Buffer): string | null => {
  const header = findTiffHeader(buf);
  if (!header) return null;

  const { start: tiff, big } = header;
  const read: Reader = {
    u16: (o) => (big ? buf.readUInt16BE(o) : buf.readUInt16LE(o)),
    u32: (o) => (big ? buf.readUInt32BE(o) : buf.readUInt32LE(o)),
  };

  try {
    const ifd0 = tiff + read.u32(tiff + 4);
    if (ifd0 + 2 > buf.length) return null;

    const exifIfd = readPointer(buf, read, ifd0, tiff, TAG_EXIF_IFD);
    const candidates = [
      exifIfd !== null ? readTag(buf, read, exifIfd, tiff, TAG_DATETIME_ORIGINAL) : null,
      exifIfd !== null ? readTag(buf, read, exifIfd, tiff, TAG_DATETIME_DIGITIZED) : null,
      readTag(buf, read, ifd0, tiff, TAG_DATETIME),
    ];

    for (const raw of candidates) {
      if (!raw) continue;
      const iso = toIsoLocal(raw);
      if (iso) return iso;
    }
  } catch {
    // Truncated or malformed metadata. Nothing to report: the caller falls back to today, which
    // is what it did before this existed.
    return null;
  }

  return null;
};
