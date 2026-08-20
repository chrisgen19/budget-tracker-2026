import { NextResponse } from "next/server";
import { GEMINI_MODEL, receiptScanConfig, generateContentWithRetry, isGeminiUnavailable } from "@/lib/gemini";
import { getAuthUserId } from "@/lib/session";
import { receiptScanResultSchema } from "@/lib/validations";
import { parseLocalDate, checkReceiptDate } from "@/lib/receipt-date";
import { guardReceiptRequest, stripCodeFences } from "@/lib/receipt-guard";
import { settleScanReservation } from "@/lib/scan-quota";

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  // Set once the guard reserves a credit, so `fail` knows whether there is one to refund.
  let reservationId: string | null = null;

  /** Refund any reserved credit and return the error. We absorb the cost of every failed
   *  scan rather than charging the user for output they never got. */
  const fail = async (message: string, status: number) => {
    if (reservationId) await settleScanReservation(reservationId, "FAILED");
    return NextResponse.json({ error: message }, { status });
  };

  // The guard reads the multipart body and hits the database, so it must run inside the
  // try: an escaping rejection would return an HTML 500 the client cannot parse as JSON,
  // surfacing to the user as a misleading "Network error".
  try {
    const guard = await guardReceiptRequest(request, userId);
    if (guard instanceof NextResponse) return guard;

    const { formData, file, mimeType, categories, categoryList } = guard;
    reservationId = guard.reservationId;

    // Date-only fallback — prefer client's local date to avoid UTC offset issues.
    // Calendar-valid (rejects e.g. "2024-13-40") to keep server output trustworthy.
    const serverToday = new Date().toISOString().slice(0, 10);
    const todayStr = parseLocalDate(formData.get("localDate"), serverToday);

    // Photo capture date from the original (uncompressed) File on the client.
    // Used as the fallback when Gemini's date is unreadable or has a wrong year.
    // Falls back to todayStr when missing/invalid so behavior is unchanged for older clients.
    const photoDateStr = parseLocalDate(formData.get("photoDate"), todayStr);

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const prompt = `Extract transaction data from this receipt image.

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

    const response = await generateContentWithRetry({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: receiptScanConfig(),
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      return await fail("Could not read the receipt. Please try a clearer photo.", 422);
    }

    const cleanJson = stripCodeFences(rawText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      return await fail("Could not read the receipt. Please try a clearer photo.", 422);
    }

    // Handle non-receipt images
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      (parsed as Record<string, unknown>).error === "NOT_A_RECEIPT"
    ) {
      return await fail(
        "This doesn't look like a receipt. Please upload a receipt image.",
        422
      );
    }

    const result = receiptScanResultSchema.safeParse({
      ...(parsed as Record<string, unknown>),
      type: "EXPENSE",
    });

    if (!result.success) {
      return await fail("Could not extract transaction details from this receipt.", 422);
    }

    // Normalize date and flag suspicious year for the UI
    const { date: normalizedDate, dateWarning, usedPhotoFallback: parseFailed } = checkReceiptDate(result.data.date, todayStr, photoDateStr);
    // Trust Gemini's explicit signal first; fall back to parse-failure detection.
    const usedPhotoFallback = result.data.dateSource === "PHOTO_FALLBACK" || parseFailed;
    result.data.date = normalizedDate;

    // Verify the categoryId actually exists in user's categories
    const categoryIds = new Set(categories.map((c) => c.id));
    const fallbackCategory =
      categories.find((c) => c.name === "Other") ?? categories[0];

    if (!categoryIds.has(result.data.categoryId) && fallbackCategory) {
      result.data.categoryId = fallbackCategory.id;
    }

    // Validate breakdown categoryIds (same logic as breakdown route)
    if (result.data.breakdown) {
      for (const item of result.data.breakdown) {
        if (!categoryIds.has(item.categoryId) && fallbackCategory) {
          item.categoryId = fallbackCategory.id;
        }
      }
    }

    // Only a scan the user can actually use consumes their monthly credit.
    await settleScanReservation(guard.reservationId, "SUCCESS");

    return NextResponse.json({ ...result.data, dateWarning, usedPhotoFallback });
  } catch (error) {
    console.error("[receipts/scan] Scan failed:", error);
    if (isGeminiUnavailable(error)) {
      return await fail(
        "The AI scanning service is busy right now. Please try again in a minute.",
        503
      );
    }
    return await fail("Failed to scan receipt. Please try again.", 500);
  }
}
