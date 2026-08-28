import {
  GEMINI_MODEL,
  receiptScanConfig,
  generateContentWithRetry,
  isGeminiUnavailable,
} from "@/lib/gemini";
import { authorizeReceiptScan, stripCodeFences, type ScanRefusal } from "@/lib/receipt-guard";
import { resolveFallbackCategory } from "@/lib/category-fallback";
import { settleScanReservation } from "@/lib/scan-quota";
import { checkReceiptDate } from "@/lib/receipt-date";
import { receiptScanResultSchema } from "@/lib/validations";
import { MAX_BREAKDOWN_GROUPS, MAX_BREAKDOWN_LINE_ITEMS } from "@/lib/receipt-limits";
import { summarizeIssues } from "@/lib/zod-issue-summary";
import { renderCategoryRules, type CategoryRule } from "@/lib/category-rules";

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
  /**
   * An itemization was produced, failed validation, and was discarded.
   *
   * Distinguishes "this receipt has one category" from "it had several and we lost the split",
   * which `multiCategory` alone cannot: both leave `breakdown` absent. It matters because the two
   * cost differently. `use-multi-scan` short-circuits Itemize when a breakdown is already present
   * — "no second call, no extra credit" — so a dropped one falls through to
   * /api/receipts/breakdown and spends a *second* scan credit. Without this flag the button looks
   * identical in both cases and the user cannot tell the free expansion from the paid one.
   */
  breakdownDropped?: boolean;
  /**
   * The year printed on the receipt, when the scan replaced it.
   *
   * A readable year is only ever overridden when it looks like a misread digit (see
   * `checkReceiptDate`), and that inference has to be visible: without this the review shows a
   * corrected date behind a generic warning, and the user cannot tell a correction from an
   * ordinary cross-year receipt, nor put back a year that was right all along.
   */
  repairedFromYear?: string;
  dateWarning: boolean;
  usedPhotoFallback: boolean;
}

/**
 * The category rules, as data rather than prose baked into the prompt string.
 *
 * Structured because the invariant that matters cannot be checked on rendered text: a rule may
 * name any category it likes, and one matching nothing does not fail — the prompt's fallback
 * quietly matches by name similarity, which is how "Household" resolved to "Housing" and filed
 * cleaning supplies beside rent. Parsing `N. Name:` back out of the finished prompt needs a
 * heuristic to tell a category rule from a prose rule that also contains a colon, and any such
 * heuristic has a blind spot where a mistake can hide. Here the category name is a field, so
 * `receipt-scan.test.ts` can check every one against DEFAULT_CATEGORIES exactly.
 */
export const SCAN_CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: "Food & Dining",
    matches:
      "food already prepared and ready to eat as sold: restaurants, cafes, hawker stalls, food courts, fast food, coffee shops, bubble tea, food delivery, and ready-to-eat items from a convenience store (7-Eleven, FairPrice, Cold Storage)",
  },
  {
    category: "Groceries",
    matches:
      "raw or packaged food bought to cook, prepare or keep at home: supermarkets, grocery stores, wet markets, palengke, seafood markets, butchers, sari-sari stores, bakeries selling bread to take home, fresh produce, meat, seafood, dairy, eggs, bread, rice, noodles, condiments, cooking ingredients, canned food, frozen food, household snacks and beverages bought by the pack",
  },
  {
    category: "Transportation",
    matches: "ride-hailing (Grab, Gojek), taxis, MRT/bus top-ups, parking, fuel/petrol, tolls",
  },
  {
    category: "Shopping",
    matches: "clothing, electronics, department stores, online shopping (Shopee, Lazada, Amazon)",
  },
  { category: "Utilities", matches: "electricity, water, gas, internet, phone and mobile bills" },
  {
    category: "Subscriptions",
    matches:
      "recurring digital services billed monthly or yearly (Netflix, Spotify, iCloud, streaming, software)",
  },
  { category: "Entertainment", matches: "movies, concerts, theme parks, games, sports" },
  {
    category: "Healthcare",
    matches:
      "doctors, clinics, pharmacies, dental, hospital, health supplements, vitamins, medicine",
  },
  {
    category: "Personal Care",
    matches:
      "soap, shampoo, toothpaste, deodorant, lotion, tissue paper, toilet paper, napkins, feminine hygiene, razors",
  },
  {
    category: "Home Supplies",
    matches:
      "cleaning supplies (detergent, bleach, dishwashing liquid, floor cleaner), garbage bags, sponges, air freshener, insect spray",
  },
  {
    category: "Housing",
    matches:
      "the home itself, not things bought for it: rent, condo dues, association fees, home repairs and maintenance",
  },
];

/** Rules that resolve ambiguity rather than describe a category. Numbered after the rules above. */
const SCAN_GUIDANCE_RULES: readonly string[] = [
  "For any category not listed above, match by comparing the merchant/items to the category name.",
  "Food & Dining vs Groceries is decided by whether the food is ready to eat as sold, NOT by the merchant selling food. A meal, a drink made to order, or anything eaten out or delivered is Food & Dining. Ingredients and packaged goods carried home to cook or store are Groceries. When one receipt holds both (a supermarket with a hot deli counter, a cafe that also sells loaves), pick whichever accounts for more of the total.",
  "Housing vs Home Supplies: Housing is the dwelling itself (rent, dues, repairs), Home Supplies is consumables bought for it. A supermarket or hardware receipt for cleaners, bags or sponges is Home Supplies and is NEVER Housing.",
  "When in doubt about a food-adjacent item (e.g. plastic wrap, aluminum foil), put it in Home Supplies.",
];

const buildPrompt = (categoryList: string, photoDateStr: string) =>
  `Extract transaction data from this receipt image.

If the image is NOT a receipt (e.g. a random photo, screenshot, or document), respond with exactly: {"error": "NOT_A_RECEIPT"}

Return a JSON object with these fields:
- "amount": the grand total / total due including tax, tips, and service charges (number). Use the largest final amount on the receipt.
- "categoryId": pick the best category ID using the rules below.
- "date": the TRANSACTION date (the date of purchase, usually near the top of the receipt next to the time). Use "YYYY-MM-DD" format (date only, no time). IMPORTANT: Ignore any "Date of Issuance", PTU accreditation dates, permit dates, or BIR registration dates — these are regulatory dates, NOT the purchase date. If the transaction date is unreadable, use "${photoDateStr}".
  This photo was taken on ${photoDateStr}. A receipt is normally photographed within days of the purchase, so the year is almost always ${photoDateStr.slice(0, 4)}. Before answering, re-read the year digits and check them against that. Only report a different year if the receipt plainly prints one — an old receipt is possible, a misread digit is far more likely.
- "dateSource": "OCR" if you read the date from the receipt itself, or "PHOTO_FALLBACK" if you used the fallback "${photoDateStr}" because the date was unreadable. Always include this field.
- "description": merchant name + short summary of purchase (max 100 chars).
- "multiCategory": true if the receipt contains items that span 2 or more DIFFERENT categories from the list below, false if all items belong to a single category. For example, a supermarket receipt with groceries AND toiletries = true, a restaurant bill with only food = false, a supermarket run that is entirely groceries = false, a single ride receipt = false.
- "breakdown": ONLY include this field when "multiCategory" is true. Read every line item on the receipt and group them by category. Each entry has: "amount" (sum for that category), "categoryId", "description" (store name + category + 1-2 sample items, max 80 chars), and "lineItems" (array of {"name": "<item name>", "amount": <price>}). The sum of all breakdown amounts should approximately equal the receipt total. Distribute tax/service proportionally or into the largest group. Do NOT include breakdown when multiCategory is false.
  All amounts must be positive numbers. A discount, promo, void or zero-priced line is NOT its own line item: subtract it from the item it applies to, or from that category's total, and never emit a zero or negative "amount".
  At most ${MAX_BREAKDOWN_GROUPS} category groups, and at most ${MAX_BREAKDOWN_LINE_ITEMS} lineItems in any one group. If a group would exceed ${MAX_BREAKDOWN_LINE_ITEMS}, merge its smallest items into a single "Other items" line so the group stays within the limit.

CATEGORIES:
${categoryList}

CATEGORY RULES (pick categoryId by matching the merchant/items to these rules):
${renderCategoryRules(SCAN_CATEGORY_RULES, SCAN_GUIDANCE_RULES)}

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
  /**
   * When the photo was taken, as an offset-less local timestamp, if it is known.
   *
   * Used only when the receipt's own date could not be read. It carries a real time as well as a
   * real date, which matters twice: the transaction lands on the day the purchase actually
   * happened rather than the day it was uploaded, and the timestamp is genuine, so the user's
   * label schedules can run against it instead of against a clock that was invented.
   */
  capturedAt?: string | null;
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

    // Why the model produced nothing usable, which was previously logged nowhere: an UNREADABLE
    // is indistinguishable from a bad photo in the UI, and a receipt heavy enough to exhaust the
    // output budget fails this way roughly as often as a genuinely blurry one. `finishReason`
    // separates them — MAX_TOKENS means the model ran out of room, SAFETY means it refused —
    // and the thinking count is the number that moves: it reached 13.8k on a 66-item receipt,
    // against output that never exceeded ~2.5k.
    const describeResponse = () => {
      const usage = response.usageMetadata;
      return [
        `finish=${response.candidates?.[0]?.finishReason ?? "unknown"}`,
        `thoughts=${usage?.thoughtsTokenCount ?? "?"}`,
        `output=${usage?.candidatesTokenCount ?? "?"}`,
      ].join(" ");
    };

    const rawText = response.text?.trim();
    if (!rawText) {
      console.warn(`[receipt-scan] model returned no text: ${describeResponse()}`);
      return await fail("UNREADABLE");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(rawText));
    } catch {
      // Shape, never content. The question worth answering here is "did the model run out of room
      // or ignore the format", and both are answered by where the text starts and stops — whereas
      // the text itself is the user's receipt: merchant, items, prices. Those belong in the
      // response, not in a log line that outlives the request.
      const body = stripCodeFences(rawText).trim();
      console.warn(
        `[receipt-scan] model returned unparseable text: ${describeResponse()} ` +
          `length=${rawText.length} startsAsJson=${body.startsWith("{")} ` +
          // A response cut off by the output budget is valid JSON right up to the point it stops,
          // so an unterminated object is the signature of truncation rather than of malformation.
          `terminated=${body.endsWith("}")}`
      );
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

    let result = receiptScanResultSchema.safeParse({
      ...(parsed as Record<string, unknown>),
      type: "EXPENSE",
    });

    // The breakdown is an enrichment, not the result. A scan whose amount, date, merchant and
    // category all read correctly was being discarded whole because the optional itemization
    // broke a bound: a supermarket receipt with 56 items in one group met a 50-item cap and the
    // user got "Failed to scan receipt" for a scan that had in fact worked.
    //
    // So retry without it, keeping `multiCategory` so the review still offers Itemize. That is a
    // partial recovery, not a guaranteed one: /api/receipts/breakdown validates against the same
    // `receiptBreakdownItemSchema` and does not degrade, so it can rebuild a breakdown Gemini
    // simply mis-shaped here, but not one whose group genuinely exceeds the item cap. Unifying
    // the two is issue-sized work; the prompt above is what keeps either case rare.
    //
    // This cannot rescue a genuinely unusable response: anything wrong outside `breakdown` fails
    // the retry too, and falls through to FAILED as before.
    let breakdownDropped = false;
    if (!result.success && parsed && typeof parsed === "object" && "breakdown" in parsed) {
      const withoutBreakdown: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
      delete withoutBreakdown.breakdown;

      const degraded = receiptScanResultSchema.safeParse({ ...withoutBreakdown, type: "EXPENSE" });
      if (degraded.success) {
        breakdownDropped = true;
        console.warn(
          "[receipt-scan] dropped an invalid breakdown and kept the scan:",
          summarizeIssues(result.error.issues)
        );
        // Only on success: a failed retry's error is about the payload minus its breakdown, which
        // is the less informative of the two for whoever reads the log below.
        result = degraded;
      }
    }
    if (!result.success) {
      // The reason a scan 500s, which used to be logged nowhere: this branch returned silently,
      // so a rejected response surfaced as a bare 500 and took a reproduction to identify.
      console.warn("[receipt-scan] response failed validation:", summarizeIssues(result.error.issues));
      return await fail("FAILED");
    }

    // Normalize date and flag a suspicious year for the caller.
    const {
      date: normalizedDate,
      dateWarning,
      usedPhotoFallback: parseFailed,
      repairedFromYear,
    } = checkReceiptDate(result.data.date, params.todayStr, params.photoDateStr);
    // Trust Gemini's explicit signal first; fall back to parse-failure detection.
    const usedPhotoFallback = result.data.dateSource === "PHOTO_FALLBACK" || parseFailed;

    // A bare date has its time filled in downstream from the current clock, which is fabricated
    // for anything not happening now. When the receipt's own date was unreadable and the photo
    // told us exactly when it was taken, that timestamp is real, so it is used whole.
    result.data.date =
      usedPhotoFallback && params.capturedAt && params.capturedAt.slice(0, 10) === normalizedDate
        ? params.capturedAt
        : normalizedDate;

    // A categoryId Gemini invented would fail the ownership check on write, so it is corrected
    // here rather than surfaced.
    const categoryIds = new Set(categories.map((c) => c.id));
    const fallbackCategory = resolveFallbackCategory(categories);

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
        // Only when true: an absent flag is the ordinary case, and emitting `false` on every
        // scan would add a field to every MCP result to say nothing happened.
        ...(breakdownDropped && { breakdownDropped: true }),
        // Present only on a repair, so the UI can say which year was replaced rather than showing
        // a bare "check year" that hides the fact anything changed.
        ...(repairedFromYear && { repairedFromYear }),
        dateWarning,
        usedPhotoFallback,
      },
    };
  } catch (error) {
    console.error("[receipt-scan] scan failed:", error);
    return await fail(isGeminiUnavailable(error) ? "AI_UNAVAILABLE" : "FAILED");
  }
}
