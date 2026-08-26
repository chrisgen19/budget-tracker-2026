import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { readPhotoTakenAt } from "@/lib/exif-date";

/**
 * Builds a TIFF/EXIF block of the shape both JPEG and HEIC embed, so the parser is exercised
 * against real structure rather than a fixture nobody can inspect.
 */
const buildExif = (
  opts: { dateTimeOriginal?: string; dateTime?: string; big?: boolean } = {}
): Buffer => {
  const big = opts.big ?? true;
  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    big ? b.writeUInt16BE(n) : b.writeUInt16LE(n);
    return b;
  };
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    big ? b.writeUInt32BE(n) : b.writeUInt32LE(n);
    return b;
  };
  const entry = (tag: number, type: number, count: number, value: Buffer) =>
    Buffer.concat([u16(tag), u16(type), u32(count), value]);

  // Layout: header(8) | IFD0 | ExifIFD | string pool
  const header = Buffer.concat([
    big ? Buffer.from([0x4d, 0x4d, 0x00, 0x2a]) : Buffer.from([0x49, 0x49, 0x2a, 0x00]),
    u32(8),
  ]);

  const ifd0Entries = opts.dateTime ? 2 : 1;
  const ifd0At = 8;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const exifAt = ifd0At + ifd0Size;
  const exifEntries = opts.dateTimeOriginal ? 1 : 0;
  const exifSize = 2 + exifEntries * 12 + 4;
  const poolAt = exifAt + exifSize;

  const pool: Buffer[] = [];
  let poolCursor = poolAt;
  const intern = (s: string) => {
    const at = poolCursor;
    const b = Buffer.from(`${s}\0`, "ascii");
    pool.push(b);
    poolCursor += b.length;
    return at;
  };

  const dtoAt = opts.dateTimeOriginal ? intern(opts.dateTimeOriginal) : 0;
  const dtAt = opts.dateTime ? intern(opts.dateTime) : 0;

  const ifd0 = Buffer.concat([
    u16(ifd0Entries),
    entry(0x8769, 4, 1, u32(exifAt)),
    ...(opts.dateTime ? [entry(0x0132, 2, 20, u32(dtAt))] : []),
    u32(0),
  ]);

  const exifIfd = Buffer.concat([
    u16(exifEntries),
    ...(opts.dateTimeOriginal ? [entry(0x9003, 2, 20, u32(dtoAt))] : []),
    u32(0),
  ]);

  return Buffer.concat([header, ifd0, exifIfd, ...pool]);
};

/** A container prefix, the way a real file buries its EXIF partway in. */
const embedded = (exif: Buffer) => Buffer.concat([Buffer.alloc(2000, 0x11), exif]);

describe("readPhotoTakenAt", () => {
  it("reads DateTimeOriginal", () => {
    expect(readPhotoTakenAt(buildExif({ dateTimeOriginal: "2026:08:01 20:05:04" }))).toBe(
      "2026-08-01T20:05:04"
    );
  });

  it("finds it when the block is buried in a container", () => {
    const buf = embedded(buildExif({ dateTimeOriginal: "2026:08:01 20:05:04" }));
    expect(readPhotoTakenAt(buf)).toBe("2026-08-01T20:05:04");
  });

  it("reads little-endian files too", () => {
    const buf = buildExif({ dateTimeOriginal: "2025:12:25 07:30:00", big: false });
    expect(readPhotoTakenAt(buf)).toBe("2025-12-25T07:30:00");
  });

  it("falls back to IFD0 DateTime when there is no shutter time", () => {
    expect(readPhotoTakenAt(buildExif({ dateTime: "2026:01:02 03:04:05" }))).toBe(
      "2026-01-02T03:04:05"
    );
  });

  // The timestamp is offset-less by specification: it is already the photographer's wall clock.
  // Appending a Z would claim UTC and shift the transaction by hours, which is the same bug the
  // Telegram prompt had.
  it("returns an offset-less local timestamp", () => {
    const iso = readPhotoTakenAt(buildExif({ dateTimeOriginal: "2026:08:01 20:05:04" }));
    expect(iso).not.toMatch(/[Zz]|[+-]\d{2}:\d{2}$/);
  });

  it("returns null when there is no metadata", () => {
    expect(readPhotoTakenAt(Buffer.alloc(0))).toBeNull();
    expect(readPhotoTakenAt(Buffer.alloc(5000, 0x42))).toBeNull();
    // A real PNG, which carries no EXIF.
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      deflateSync(Buffer.alloc(64)),
    ]);
    expect(readPhotoTakenAt(png)).toBeNull();
  });

  it("rejects a camera whose clock was never set", () => {
    expect(readPhotoTakenAt(buildExif({ dateTimeOriginal: "0000:00:00 00:00:00" }))).toBeNull();
  });

  it("rejects an impossible date rather than passing it on", () => {
    expect(readPhotoTakenAt(buildExif({ dateTimeOriginal: "2026:13:40 25:70:00" }))).toBeNull();
  });

  it("survives a truncated file without throwing", () => {
    const full = embedded(buildExif({ dateTimeOriginal: "2026:08:01 20:05:04" }));
    for (const cut of [2010, 2020, 2030, 2040]) {
      expect(() => readPhotoTakenAt(full.subarray(0, cut))).not.toThrow();
    }
  });
});
