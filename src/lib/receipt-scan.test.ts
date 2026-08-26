import { describe, expect, it, vi, beforeEach } from "vitest";

const authorize = vi.hoisted(() => vi.fn());
const settle = vi.hoisted(() => vi.fn(async () => {}));
const generate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/receipt-guard", () => ({
  authorizeReceiptScan: authorize,
  stripCodeFences: (t: string) => t,
}));
vi.mock("@/lib/scan-quota", () => ({ settleScanReservation: settle }));
vi.mock("@/lib/gemini", () => ({
  GEMINI_MODEL: "test-model",
  receiptScanConfig: () => ({}),
  generateContentWithRetry: generate,
  isGeminiUnavailable: () => false,
}));

const { scanReceipt } = await import("@/lib/receipt-scan");

const AUTHORIZED = {
  ok: true,
  context: {
    categories: [{ id: "cat_1", name: "Food & Dining" }],
    categoryList: '- "Food & Dining" (id: "cat_1")',
    timezoneOffset: -480,
    reservationId: "res_1",
  },
};

beforeEach(() => vi.clearAllMocks());

describe("scanReceipt", () => {
  // The bug this covers: the route used to encode the image before anything checked its size,
  // allocating the decoded buffer and its larger base64 form first. The pre-refactor guard
  // validated the upload before the route ever called arrayBuffer(), and passing an already
  // encoded string gave that up. checkBodySize does not cover it: a chunked request carries no
  // content-length.
  it("does not read the image when the scan is refused", async () => {
    authorize.mockResolvedValue({ ok: false, refusal: { reason: "TOO_LARGE" } });
    const readBase64 = vi.fn(() => "should-never-be-called");

    const outcome = await scanReceipt({
      userId: "u1",
      mimeType: "image/jpeg",
      byteLength: 99_000_000,
      readBase64,
      todayStr: "2026-08-26",
      photoDateStr: "2026-08-26",
    });

    expect(outcome).toEqual({ ok: false, refusal: { reason: "TOO_LARGE" } });
    expect(readBase64).not.toHaveBeenCalled();
    // Nothing was reserved, so nothing needs settling.
    expect(settle).not.toHaveBeenCalled();
  });

  it("reads the image once the scan is authorized", async () => {
    authorize.mockResolvedValue(AUTHORIZED);
    generate.mockResolvedValue({
      text: JSON.stringify({
        amount: 350,
        categoryId: "cat_1",
        date: "2026-08-26",
        dateSource: "OCR",
        description: "SM Supermarket",
        multiCategory: false,
      }),
    });
    const readBase64 = vi.fn(() => "aW1hZ2U=");

    const outcome = await scanReceipt({
      userId: "u1",
      mimeType: "image/jpeg",
      byteLength: 1_000,
      readBase64,
      todayStr: "2026-08-26",
      photoDateStr: "2026-08-26",
    });

    expect(readBase64).toHaveBeenCalledOnce();
    expect(outcome.ok).toBe(true);
    // Only a scan the user can use spends their credit.
    expect(settle).toHaveBeenCalledWith("res_1", "SUCCESS");
  });

  it("refunds the credit when the image is not a receipt", async () => {
    authorize.mockResolvedValue(AUTHORIZED);
    generate.mockResolvedValue({ text: JSON.stringify({ error: "NOT_A_RECEIPT" }) });

    const outcome = await scanReceipt({
      userId: "u1",
      mimeType: "image/jpeg",
      byteLength: 1_000,
      readBase64: () => "aW1hZ2U=",
      todayStr: "2026-08-26",
      photoDateStr: "2026-08-26",
    });

    expect(outcome).toMatchObject({ ok: false, failure: { reason: "NOT_A_RECEIPT" } });
    expect(settle).toHaveBeenCalledWith("res_1", "FAILED");
  });

  it("refunds the credit when reading the image itself fails", async () => {
    authorize.mockResolvedValue(AUTHORIZED);

    const outcome = await scanReceipt({
      userId: "u1",
      mimeType: "image/jpeg",
      byteLength: 1_000,
      readBase64: () => {
        throw new Error("stream closed");
      },
      todayStr: "2026-08-26",
      photoDateStr: "2026-08-26",
    });

    expect(outcome.ok).toBe(false);
    expect(settle).toHaveBeenCalledWith("res_1", "FAILED");
  });
});

describe("scan result shape", () => {
  // The bug this covers: the payload was built by spreading receiptScanResultSchema's output,
  // which carries `dateSource`. That leaked into the MCP tool's structuredContent, and the SDK
  // *client* validates structuredContent against the declared output schema and rejects unknown
  // properties, so every successful scan failed at the caller with a schema error. Nothing
  // in-process caught it; scripts/verify-receipt-scan.ts did, against a real client.
  it("returns only the fields the output schema declares", async () => {
    authorize.mockResolvedValue(AUTHORIZED);
    generate.mockResolvedValue({
      text: JSON.stringify({
        amount: 470,
        categoryId: "cat_1",
        date: "2026-08-01",
        dateSource: "OCR",
        description: "The Coffee Bean",
        multiCategory: false,
      }),
    });

    const outcome = await scanReceipt({
      userId: "u1",
      mimeType: "image/jpeg",
      byteLength: 1_000,
      readBase64: () => "aW1hZ2U=",
      todayStr: "2026-08-26",
      photoDateStr: "2026-08-26",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !("result" in outcome)) return;

    expect(Object.keys(outcome.result).sort()).toEqual(
      [
        "amount",
        "categoryId",
        "date",
        "dateWarning",
        "description",
        "multiCategory",
        "type",
        "usedPhotoFallback",
      ].sort()
    );
    expect(outcome.result).not.toHaveProperty("dateSource");
  });
});

describe("capture date fallback", () => {
  const unreadableDate = () =>
    generate.mockResolvedValue({
      text: JSON.stringify({
        amount: 470,
        categoryId: "cat_1",
        // Gemini says outright that it could not read the receipt's own date.
        date: "2026-08-01",
        dateSource: "PHOTO_FALLBACK",
        description: "The Coffee Bean",
        multiCategory: false,
      }),
    });

  // The bug this covers: with no capture date the Telegram path fell back to *today*, so a
  // receipt photographed on Monday and sent on Thursday landed on Thursday. The photo knows
  // better, and it knows the time too, so the timestamp is real rather than an invented clock.
  it("uses the capture timestamp whole when the receipt's date was unreadable", async () => {
    authorize.mockResolvedValue(AUTHORIZED);
    unreadableDate();

    const outcome = await scanReceipt({
      userId: "u1",
      mimeType: "image/jpeg",
      byteLength: 1_000,
      readBase64: () => "aW1hZ2U=",
      todayStr: "2026-08-26",
      photoDateStr: "2026-08-01",
      capturedAt: "2026-08-01T20:05:04",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !("result" in outcome)) return;
    expect(outcome.result.date).toBe("2026-08-01T20:05:04");
    expect(outcome.result.usedPhotoFallback).toBe(true);
  });

  it("keeps a bare date when no capture time is known", async () => {
    authorize.mockResolvedValue(AUTHORIZED);
    unreadableDate();

    const outcome = await scanReceipt({
      userId: "u1",
      mimeType: "image/jpeg",
      byteLength: 1_000,
      readBase64: () => "aW1hZ2U=",
      todayStr: "2026-08-26",
      photoDateStr: "2026-08-01",
    });

    if (!outcome.ok || !("result" in outcome)) return;
    expect(outcome.result.date).toBe("2026-08-01");
  });

  it("does not override a date the receipt itself supplied", async () => {
    authorize.mockResolvedValue(AUTHORIZED);
    generate.mockResolvedValue({
      text: JSON.stringify({
        amount: 470,
        categoryId: "cat_1",
        date: "2026-08-01",
        // Read from the receipt, so the capture time is irrelevant: the purchase date is what
        // matters, and a photo taken later must not move it.
        dateSource: "OCR",
        description: "The Coffee Bean",
        multiCategory: false,
      }),
    });

    const outcome = await scanReceipt({
      userId: "u1",
      mimeType: "image/jpeg",
      byteLength: 1_000,
      readBase64: () => "aW1hZ2U=",
      todayStr: "2026-08-26",
      photoDateStr: "2026-08-01",
      capturedAt: "2026-08-04T11:00:00",
    });

    if (!outcome.ok || !("result" in outcome)) return;
    expect(outcome.result.date).toBe("2026-08-01");
  });
});
