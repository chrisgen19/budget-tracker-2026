import {
  GEMINI_MODEL,
  receiptScanConfig,
  generateContentWithRetry,
  isGeminiUnavailable,
} from "@/lib/gemini";
import { authorizeReceiptScan, stripCodeFences, type ScanRefusal } from "@/lib/receipt-guard";
import { settleScanReservation } from "@/lib/scan-quota";
import { checkReceiptDate } from "@/lib/receipt-date";
import { receiptScanResultSchema } from "@/lib/validations";

/** Why a scan produced nothing usable, once it was authorized and the credit was held. */
export type ScanFailure =
  | { reason: "NOT_A_RECEIPT" }
  | { reason: "UNREADABLE" }
  | { reason: "AI_UNAVAILABLE" }
  | { reason: "FAILED" };

export type ReceiptScanOutcome =
  | { ok: true; result: ScanResultPayload }
  | { ok: false; refusal: ScanRefusal }
  | { ok: false; failure: ScanFailure };

export interface ScanResultPayload {
  amount: number;
  categoryId: string;
  date: string;
  description: string;
  type: "EXPENSE";
  multiCategory?: boolean;
  breakdown?: unknown;
  dateWarning: boolean;
  usedPhotoFallback: boolean;
}

const buildPrompt = (categoryList: string, photoDateStr: string) =>
  `Extract transaction data from this receipt image.

If the image is NOT a receipt (e.g. a random photo, screenshot, or document), respond with exactly: {"error": "NOT_A_RECEIPT"}

Return a JSON object with these fields:
- "amount": the grand total / total due including tax, tips, and service charges (number). Use the largest final amount on the receipt.
- "categoryId": pick the best category ID using the rules below.
- "date": the TRANSACTION date (the date of purchase, usually near the top of the receipt next to the time). Use "YYYY-MM-DD" format (date only, no time). IMPORTANT: Ignore any "Date of Issuance", PTU accreditation dates, permit dates, or BIR registration dates — these are regulatory dates, NOT the purchase date. If the transaction date is unreadable, use "${photoDateStr}".
- "dateSource": "OCR" if you read the date from the receipt itself, or "PHOTO_FALLBACK" if you used the fallback "${photoDateStr}" because the date was unreadable. Always include this field.
- "description": merchant name + short summary of purchase (max 100 chars).
- "multiCategory": true if the receipt contains items that span 2 or more DIFFERENT categories from the list below, false if all items belong to a single category. For example, a grocery receipt with food AND cleaning supplies = true, a restaurant bill with only food = false, a single ride receipt = false.
- "breakdown": ONLY include this field when "multiCategory" is true. Read every line item on the receipt and group them by category. Each entry has: "amount" (sum for that category), "categoryId", "description" (store name + category + 1-2 sample items, max 80 chars), and "lineItems" (array of {"name": "<item name>", "amount": <price>}). The sum of all breakdown amounts should approximately equal the receipt total. Distribute tax/service proportionally or into the largest group. Do NOT include breakdown when multiCategory is false.

CATEGORIES:
${categoryList}

CATEGORY RULES (pick categoryId by matching the merchant/items to these rules):
1. Food & Dining: restaurants, cafes, hawker stalls, food courts, bakeries, fast food, coffee shops, bubble tea, food delivery, supermarkets, grocery stores, wet markets, seafood markets, butchers, convenience stores (7-Eleven, FairPrice, Cold Storage), food items, beverages, snacks, condiments, cooking ingredients, fresh produce, meat, dairy, bread, canned food, frozen food
2. Transportation: ride-hailing (Grab, Gojek), taxis, MRT/bus top-ups, parking, fuel/petrol, tolls
3. Shopping: clothing, electronics, department stores, online shopping (Shopee, Lazada, Amazon)
4. Bills & Utilities: electricity, water, gas, internet, phone bills, subscriptions (Netflix, Spotify)
5. Entertainment: movies, concerts, theme parks, games, sports, streaming services
6. Healthcare: doctors, clinics, pharmacies, dental, hospital, health supplements, vitamins, medicine
7. Personal Care: soap, shampoo, toothpaste, deodorant, lotion, tissue paper, toilet paper, napkins, feminine hygiene, razors
8. Household: cleaning supplies (detergent, bleach, dishwashing liquid, floor cleaner), garbage bags, sponges, air freshener, insect spray
9. For any category not listed above, match by comparing the merchant/items to the category name.
10. When in doubt, prefer "Food & Dining" if the merchant sells any food or beverages.
11. When in doubt about a food-adjacent item (e.g. plastic wrap, aluminum foil), put it in Household.

Respond with ONLY valid JSON, no markdown or explanation:
{"amount": <number>, "categoryId": "<id>", "date": "<YYYY-MM-DD>", "dateSource": "OCR" | "PHOTO_FALLBACK", "description": "<text>", "multiCategory": <boolean>}
or when multiCategory is true:
{"amount": <number>, "categoryId": "<id>", "date": "<YYYY-MM-DD>", "dateSource": "OCR" | "PHOTO_FALLBACK", "description": "<text>", "multiCategory": true, "breakdown": [{"amount": <number>, "categoryId": "<id>", "description": "<text>", "lineItems": [{"name": "<text>", "amount": <number>}]}]}`;

/**
 * Scan one receipt image: authorize, call Gemini, validate what comes back, settle the credit.
 *
 * The whole operation lives here rather than in the route because it is now reached from two
 * places, and the half that matters most is the metering. `authorizeReceiptScan` reserves a
 * credit before the Gemini call and every exit below settles it: SUCCESS only when the caller
 * gets a usable result, FAILED otherwise, so nobody is charged for output they cannot use.
 *
 * A caller that talked to Gemini itself would skip the role gate, the monthly cap and the rate
 * limit, which is the reason the MCP tool goes through here rather than holding its own client.
 *
 * @param todayStr The caller's local date, used to sanity-check the year Gemini reads.
 * @param photoDateStr Fallback date when the receipt's own is unreadable.
 */
export async function scanReceipt(params: {
  userId: string;
  mimeType: string;
  /** Decoded size, checked before the image is read into memory. */
  byteLength: number;
  /**
   * Produces the base64 image, called only once the scan is authorized.
   *
   * Lazy on purpose. Encoding eagerly allocated the decoded buffer and its base64 form, which is
   * a third larger again, *before* anything had checked the size: the pre-refactor guard
   * validated the upload before the route ever called `arrayBuffer()`, and passing an already
   * encoded string here quietly gave that up. `checkBodySize` does not cover it, since a chunked
   * request carries no `content-length` to check.
   */
  readBase64: () => Promise<string> | string;
  todayStr: string;
  photoDateStr: string;
}): Promise<ReceiptScanOutcome> {
  const auth = await authorizeReceiptScan({
    userId: params.userId,
    mimeType: params.mimeType,
    byteLength: params.byteLength,
  });
  if (!auth.ok) return { ok: false, refusal: auth.refusal };

  const { categories, categoryList, reservationId } = auth.context;

  /** Every failure after the reservation refunds it. */
  const fail = async (reason: ScanFailure["reason"]): Promise<ReceiptScanOutcome> => {
    await settleScanReservation(reservationId, "FAILED");
    return { ok: false, failure: { reason } };
  };

  try {
    const base64 = await params.readBase64();

    const response = await generateContentWithRetry({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: params.mimeType, data: base64 } },
            { text: buildPrompt(categoryList, params.photoDateStr) },
          ],
        },
      ],
      config: receiptScanConfig(),
    });

    const rawText = response.text?.trim();
    if (!rawText) return await fail("UNREADABLE");

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(rawText));
    } catch {
      return await fail("UNREADABLE");
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      (parsed as Record<string, unknown>).error === "NOT_A_RECEIPT"
    ) {
      return await fail("NOT_A_RECEIPT");
    }

    const result = receiptScanResultSchema.safeParse({
      ...(parsed as Record<string, unknown>),
      type: "EXPENSE",
    });
    if (!result.success) return await fail("FAILED");

    // Normalize date and flag a suspicious year for the caller.
    const { date: normalizedDate, dateWarning, usedPhotoFallback: parseFailed } = checkReceiptDate(
      result.data.date,
      params.todayStr,
      params.photoDateStr,
    );
    // Trust Gemini's explicit signal first; fall back to parse-failure detection.
    const usedPhotoFallback = result.data.dateSource === "PHOTO_FALLBACK" || parseFailed;
    result.data.date = normalizedDate;

    // A categoryId Gemini invented would fail the ownership check on write, so it is corrected
    // here rather than surfaced.
    const categoryIds = new Set(categories.map((c) => c.id));
    const fallbackCategory = categories.find((c) => c.name === "Other") ?? categories[0];

    if (!categoryIds.has(result.data.categoryId) && fallbackCategory) {
      result.data.categoryId = fallbackCategory.id;
    }
    if (result.data.breakdown) {
      for (const item of result.data.breakdown) {
        if (!categoryIds.has(item.categoryId) && fallbackCategory) {
          item.categoryId = fallbackCategory.id;
        }
      }
    }

    // Only a scan the user can actually use consumes their monthly credit.
    await settleScanReservation(reservationId, "SUCCESS");

    // Built field by field rather than spread. `receiptScanResultSchema` carries `dateSource`,
    // Gemini's own raw signal, which nothing downstream needs once `usedPhotoFallback` has been
    // derived from it. Spreading leaked it into the MCP tool's `structuredContent`, and the SDK
    // *client* validates that against the declared output schema and rejects unknown properties,
    // so every successful scan failed at the caller with a schema error.
    return {
      ok: true,
      result: {
        amount: result.data.amount,
        categoryId: result.data.categoryId,
        date: result.data.date,
        description: result.data.description,
        type: "EXPENSE",
        multiCategory: result.data.multiCategory,
        ...(result.data.breakdown && { breakdown: result.data.breakdown }),
        dateWarning,
        usedPhotoFallback,
      },
    };
  } catch (error) {
    console.error("[receipt-scan] scan failed:", error);
    return await fail(isGeminiUnavailable(error) ? "AI_UNAVAILABLE" : "FAILED");
  }
}
