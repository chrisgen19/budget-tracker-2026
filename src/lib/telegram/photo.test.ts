import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, pickReceiptImage } from "@/lib/telegram/photo";
import type { TelegramMessage } from "@/lib/telegram/allowlist";

const base: TelegramMessage = { chat: { id: 1, type: "private" } };

describe("pickReceiptImage", () => {
  it("ignores a message with no image", () => {
    expect(pickReceiptImage({ ...base, text: "100 lunch" }).kind).toBe("none");
  });

  it("picks the largest photo size, not the first", () => {
    // Telegram usually orders these ascending, but the API does not promise it, and picking the
    // wrong one costs OCR accuracy on small print.
    const pick = pickReceiptImage({
      ...base,
      photo: [
        { file_id: "big", file_size: 900_000 },
        { file_id: "small", file_size: 1_000 },
      ],
    });
    expect(pick).toMatchObject({ kind: "ok", fileId: "big", mimeType: "image/jpeg" });
  });

  it("prefers a document over a photo, since Telegram has not recompressed it", () => {
    const pick = pickReceiptImage({
      ...base,
      photo: [{ file_id: "compressed", file_size: 50_000 }],
      document: { file_id: "original", mime_type: "image/png", file_size: 80_000 },
    });
    expect(pick).toMatchObject({ kind: "ok", fileId: "original", mimeType: "image/png" });
  });

  it("refuses a document that is not a scannable image", () => {
    const pick = pickReceiptImage({
      ...base,
      document: { file_id: "d", mime_type: "application/pdf", file_size: 10 },
    });
    expect(pick).toEqual({ kind: "unsupported", mimeType: "application/pdf" });
  });

  it("refuses a document with no mime type at all", () => {
    const pick = pickReceiptImage({ ...base, document: { file_id: "d" } });
    expect(pick.kind).toBe("unsupported");
  });

  // Refused here rather than after downloading it, and rather than by the scan pipeline, so the
  // user gets a reason instead of a generic failure and no credit is ever reserved.
  it("refuses an oversized photo before anything is downloaded", () => {
    const pick = pickReceiptImage({
      ...base,
      photo: [{ file_id: "huge", file_size: MAX_IMAGE_BYTES + 1 }],
    });
    expect(pick).toEqual({ kind: "too_large", bytes: MAX_IMAGE_BYTES + 1 });
  });

  it("refuses an oversized document too", () => {
    const pick = pickReceiptImage({
      ...base,
      document: { file_id: "d", mime_type: "image/jpeg", file_size: MAX_IMAGE_BYTES + 1 },
    });
    expect(pick.kind).toBe("too_large");
  });

  it("accepts every format the scan pipeline allows", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) {
      const pick = pickReceiptImage({
        ...base,
        document: { file_id: "d", mime_type: mime, file_size: 100 },
      });
      expect(pick.kind, mime).toBe("ok");
    }
  });
});
