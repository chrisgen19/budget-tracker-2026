import { describe, expect, it, vi, beforeEach } from "vitest";
import { MAX_BREAKDOWN_LINE_ITEMS } from "@/lib/receipt-limits";

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

/** The fixed-params call both degrade suites make; defined once so a signature change is one edit. */
const scan = () =>
  scanReceipt({
    userId: "u1",
    mimeType: "image/jpeg",
    byteLength: 1_000,
    readBase64: () => "aW1hZ2U=",
    todayStr: "2026-08-26",
    photoDateStr: "2026-08-26",
  });

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

describe("oversized breakdown", () => {
  /** What Gemini returns for a weekly supermarket run: one group holding every grocery line. */
  const receiptWith = (lineItemCount: number) => ({
    amount: 7193.6,
    categoryId: "cat_1",
    date: "2026-08-26",
    dateSource: "OCR",
    description: "SOUTH SUPERMARKET - PASIG",
    multiCategory: true,
    breakdown: [
      {
        amount: 6586.9,
        categoryId: "cat_1",
        description: "South Supermarket - groceries",
        lineItems: Array.from({ length: lineItemCount }, (_, i) => ({
          name: `item ${i}`,
          amount: 1,
        })),
      },
    ],
  });

  beforeEach(() => authorize.mockResolvedValue(AUTHORIZED));

  // The bug: lineItems was capped at 50, a real supermarket receipt carried 56, and the whole
  // scan was rejected — POST /api/receipts/scan 500, "Failed to scan receipt. Please try again."
  // — despite the amount, date, merchant and category all having been read correctly.
  it("keeps a 56-item breakdown now that the bound reflects a real receipt", async () => {
    generate.mockResolvedValue({ text: JSON.stringify(receiptWith(56)) });

    const outcome = await scan();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !("result" in outcome)) return;
    expect(outcome.result.amount).toBe(7193.6);
    expect(outcome.result.breakdown).toBeDefined();
    // Absent, not false: a scan that kept its breakdown must not carry the flag, or the review
    // would offer a credit warning on the free path.
    expect(outcome.result.breakdownDropped).toBeUndefined();
    expect(settle).toHaveBeenCalledWith("res_1", "SUCCESS");
  });

  // Past the bound the breakdown is dropped rather than the scan: the amount and date are still
  // right, and multiCategory survives so the review still offers Itemize to rebuild it.
  it("drops a breakdown past the bound but still returns the scan", async () => {
    generate.mockResolvedValue({
      text: JSON.stringify(receiptWith(MAX_BREAKDOWN_LINE_ITEMS + 1)),
    });

    const outcome = await scan();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !("result" in outcome)) return;
    expect(outcome.result.amount).toBe(7193.6);
    expect(outcome.result.description).toBe("SOUTH SUPERMARKET - PASIG");
    expect(outcome.result.breakdown).toBeUndefined();
    expect(outcome.result.multiCategory).toBe(true);
    // The whole point of the flag: multiCategory alone cannot tell "one category" from
    // "several, and we lost the split", and only the latter makes Itemize cost a credit.
    expect(outcome.result.breakdownDropped).toBe(true);
    expect(settle).toHaveBeenCalledWith("res_1", "SUCCESS");
  });

  // The retry must not become a way to smuggle a broken scan through: dropping the breakdown
  // only rescues a response whose every other field was already valid.
  it("still fails when the response is broken outside the breakdown", async () => {
    generate.mockResolvedValue({
      text: JSON.stringify({ ...receiptWith(MAX_BREAKDOWN_LINE_ITEMS + 1), amount: -5 }),
    });

    const outcome = await scan();

    expect(outcome).toMatchObject({ ok: false, failure: { reason: "FAILED" } });
    expect(settle).toHaveBeenCalledWith("res_1", "FAILED");
  });
});

describe("breakdown invalid for reasons other than size", () => {
  beforeEach(() => authorize.mockResolvedValue(AUTHORIZED));

  // lineItems.amount is z.number().positive(), and a receipt with a "FREE 0.00" or
  // "-25.00 SENIOR DISC" line is ordinary here. Before the prompt told Gemini to fold those into
  // the item they apply to, one such line invalidated the whole breakdown — and once scanReceipt
  // learned to degrade, that stopped being loud: the user was billed a credit for an itemization
  // they never received. The scan still has to survive, and the credit still has to be spent
  // knowingly rather than silently, so this pins the degraded shape rather than the old refusal.
  it("drops a breakdown carrying a zero-amount promo line but keeps the scan", async () => {
    generate.mockResolvedValue({
      text: JSON.stringify({
        amount: 1240,
        categoryId: "cat_1",
        date: "2026-08-26",
        dateSource: "OCR",
        description: "SM Supermarket",
        multiCategory: true,
        breakdown: [
          {
            amount: 1240,
            categoryId: "cat_1",
            description: "Groceries",
            lineItems: [
              { name: "Rice 5kg", amount: 1240 },
              { name: "FREE 1PC TUMBLER", amount: 0 },
            ],
          },
        ],
      }),
    });

    const outcome = await scan();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !("result" in outcome)) return;
    expect(outcome.result.amount).toBe(1240);
    expect(outcome.result.breakdown).toBeUndefined();
    expect(outcome.result.breakdownDropped).toBe(true);
    expect(settle).toHaveBeenCalledWith("res_1", "SUCCESS");
  });

  // The reason this class of bug took a full reproduction to find: the rejection branch returned
  // without logging, so a 500 arrived with nothing beside it in the server output.
  it("logs why a response was rejected when even the degraded parse fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generate.mockResolvedValue({
      text: JSON.stringify({
        amount: 1240,
        categoryId: "cat_1",
        date: "2026-08-26",
        dateSource: "OCR",
        description: "x".repeat(300), // too long with or without the breakdown
        multiCategory: true,
        breakdown: [{ amount: 1240, categoryId: "cat_1", description: "G", lineItems: [] }],
      }),
    });

    const outcome = await scan();

    expect(outcome).toMatchObject({ ok: false, failure: { reason: "FAILED" } });
    expect(warn).toHaveBeenCalledWith(
      "[receipt-scan] response failed validation:",
      expect.stringContaining("description")
    );
    warn.mockRestore();
  });

  // The log line scales with the payload — one issue per bad item, up to 20 x 150 of them.
  it("caps the issue list rather than logging one line per bad item", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generate.mockResolvedValue({
      text: JSON.stringify({
        amount: 1240,
        categoryId: "cat_1",
        date: "2026-08-26",
        dateSource: "OCR",
        description: "SM Supermarket",
        multiCategory: true,
        breakdown: [
          {
            amount: 1240,
            categoryId: "cat_1",
            description: "Groceries",
            // Every line invalid, so Zod reports one issue per item.
            lineItems: Array.from({ length: 60 }, (_, i) => ({ name: `i${i}`, amount: 0 })),
          },
        ],
      }),
    });

    await scan();

    const logged = warn.mock.calls[0]?.[1] as string;
    expect(logged).toContain("more)");
    expect(logged.split(";").length).toBeLessThanOrEqual(5);
    warn.mockRestore();
  });
});

describe("unreadable responses", () => {
  beforeEach(() => authorize.mockResolvedValue(AUTHORIZED));

  // Why this class of failure needed a log at all: an UNREADABLE reaches the user as "Could not
  // read the receipt. Please try a clearer photo." — advice that is wrong when the real cause was
  // a receipt heavy enough to exhaust the output budget. Nothing distinguished the two.
  it("logs why the model returned nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generate.mockResolvedValue({
      text: "",
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { thoughtsTokenCount: 13863, candidatesTokenCount: 0 },
    });

    const outcome = await scan();

    expect(outcome).toMatchObject({ ok: false, failure: { reason: "UNREADABLE" } });
    const logged = warn.mock.calls[0]?.[0] as string;
    expect(logged).toContain("MAX_TOKENS");
    expect(logged).toContain("13863");
    expect(settle).toHaveBeenCalledWith("res_1", "FAILED");
    warn.mockRestore();
  });

  it("reports a truncated response by its shape", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Valid JSON right up to the cut, which is what a budget-exhausted response looks like.
    generate.mockResolvedValue({
      text: '{"amount": 7193.6, "breakdown": [{"lineItems": [{"name": "Rice 5kg", "amount": 12',
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { thoughtsTokenCount: 9000, candidatesTokenCount: 2500 },
    });

    const outcome = await scan();

    expect(outcome).toMatchObject({ ok: false, failure: { reason: "UNREADABLE" } });
    const logged = warn.mock.calls[0]?.[0] as string;
    expect(logged).toContain("MAX_TOKENS");
    expect(logged).toContain("startsAsJson=true");
    expect(logged).toContain("terminated=false");
    warn.mockRestore();
  });

  // The log outlives the request, and the response body is the user's receipt: merchant, items,
  // prices. None of it is needed to tell a truncation from a refusal, so none of it is written.
  it("keeps receipt content out of the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generate.mockResolvedValue({
      text: '{"description": "SOUTH SUPERMARKET", "amount": 7193.6, "items": [{"name": "Rice 5kg"',
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: { thoughtsTokenCount: 9000, candidatesTokenCount: 2500 },
    });

    await scan();

    const logged = warn.mock.calls[0]?.[0] as string;
    expect(logged).not.toContain("SOUTH SUPERMARKET");
    expect(logged).not.toContain("Rice");
    expect(logged).not.toContain("7193");
    warn.mockRestore();
  });

  it("reports a non-JSON response as such, rather than as a truncation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    generate.mockResolvedValue({
      text: "I am unable to read this receipt image.",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { thoughtsTokenCount: 500, candidatesTokenCount: 12 },
    });

    await scan();

    const logged = warn.mock.calls[0]?.[0] as string;
    expect(logged).toContain("startsAsJson=false");
    warn.mockRestore();
  });
});

/**
 * The bug these cover: the scan prompt hardcoded "supermarkets, grocery stores, wet markets,
 * seafood markets, butchers" into the Food & Dining rule, and a tie-breaker that preferred
 * Food & Dining "if the merchant sells any food or beverages". A user who splits Groceries out
 * into its own category would have every supermarket receipt filed back under Food & Dining by
 * their own scanner, with nothing failing to say so.
 */
describe("scan prompt category routing", () => {
  /** Pull the rule line that starts with `<n>. <name>:` out of the prompt Gemini was sent. */
  const ruleFor = async (category: string) => {
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
    await scan();

    const parts = generate.mock.calls[0][0].contents[0].parts as Array<{ text?: string }>;
    const prompt = parts.find((p) => typeof p.text === "string")!.text!;
    const line = prompt
      .split("\n")
      .find((l) => new RegExp(`^\\d+\\. ${category}:`).test(l.trim()));
    return line ?? "";
  };

  it("routes supermarkets and wet markets to Groceries, not Food & Dining", async () => {
    const groceries = await ruleFor("Groceries");

    expect(groceries).not.toBe("");
    for (const merchant of ["supermarkets", "grocery stores", "wet markets", "butchers"]) {
      expect(groceries).toContain(merchant);
    }
  });

  it("leaves only ready-to-eat merchants on the Food & Dining rule", async () => {
    const dining = await ruleFor("Food & Dining");

    expect(dining).toContain("restaurants");
    expect(dining).toContain("food delivery");
    // The exact words that used to send every grocery run here.
    for (const merchant of ["supermarkets", "grocery stores", "wet markets", "butchers"]) {
      expect(dining).not.toContain(merchant);
    }
  });

  it("does not fall back to Food & Dining merely because a merchant sells food", async () => {
    const dining = await ruleFor("Food & Dining");
    const parts = generate.mock.calls[0][0].contents[0].parts as Array<{ text?: string }>;
    const prompt = parts.find((p) => typeof p.text === "string")!.text!;

    expect(dining).not.toBe("");
    // The old blanket tie-breaker. Its replacement decides on ready-to-eat instead.
    expect(prompt).not.toContain('prefer "Food & Dining" if the merchant sells any food');
    expect(prompt).toContain("ready to eat as sold");
  });
});
