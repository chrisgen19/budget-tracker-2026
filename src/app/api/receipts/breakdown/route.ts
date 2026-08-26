import { NextResponse } from "next/server";
import { GEMINI_MODEL, receiptScanConfig, generateContentWithRetry, isGeminiUnavailable } from "@/lib/gemini";
import { getAuthUserId } from "@/lib/session";
import { receiptBreakdownResultSchema } from "@/lib/validations";
import { parseLocalDate, checkReceiptDate } from "@/lib/receipt-date";
import { guardReceiptRequest, stripCodeFences } from "@/lib/receipt-guard";
import { MAX_BREAKDOWN_GROUPS, MAX_BREAKDOWN_LINE_ITEMS } from "@/lib/receipt-limits";
import { settleScanReservation } from "@/lib/scan-quota";

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  // Set once the guard reserves a credit, so `fail` knows whether there is one to refund.
  let reservationId: string | null = null;

  /** Refund any reserved credit and return the error. We absorb the cost of every failed
   *  itemisation rather than charging the user for output they never got. */
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
    const serverToday = new Date().toISOString().slice(0, 10);
    const todayStr = parseLocalDate(formData.get("localDate"), serverToday);
    // Photo capture date from the original (uncompressed) File on the client.
    const photoDateStr = parseLocalDate(formData.get("photoDate"), todayStr);

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const prompt = `You are an expert receipt analyzer. Read EVERY line item on this receipt and group them by spending category.

If the image is NOT a receipt (e.g. a random photo, screenshot, or document), respond with exactly: {"error": "NOT_A_RECEIPT"}

INSTRUCTIONS:
1. Read every individual item/product on the receipt
2. Assign each item to one of the categories below based on these rules
3. Group items by category and sum their amounts per group
4. Return one entry per category, with the individual line items listed inside

CATEGORIES:
${categoryList}

CATEGORY RULES:
1. Food & Dining: food items, beverages, snacks, condiments, cooking ingredients, fresh produce, meat, dairy, bread, canned food, frozen food, instant noodles, rice, eggs
2. Personal Care: soap, shampoo, toothpaste, deodorant, lotion, tissue paper, toilet paper, napkins, feminine hygiene, cotton buds, razors
3. Household: cleaning supplies (detergent, bleach, dishwashing liquid, floor cleaner), garbage bags, sponges, air freshener, insect spray
4. Healthcare: vitamins, medicine, first aid, health supplements
5. Shopping: clothing, electronics, toys, home decor, kitchenware
6. For any item not clearly matching the above, match by comparing to the category name
7. When in doubt about a food-adjacent item (e.g. plastic wrap, aluminum foil), put it in Household

RESPONSE FORMAT — return ONLY valid JSON, no markdown or explanation:
{
  "date": "<YYYY-MM-DD — the TRANSACTION/purchase date, usually near the top of the receipt next to the time. IGNORE any 'Date of Issuance', PTU accreditation, permit, or BIR registration dates. Use ${photoDateStr} if unreadable>",
  "dateSource": "<\"OCR\" if you read the date from the receipt, or \"PHOTO_FALLBACK\" if you used the fallback ${photoDateStr} because the date was unreadable. Always include this field.>",
  "items": [
    {
      "amount": <sum of items in this category>,
      "categoryId": "<id>",
      "description": "<store name> - <category name>: <1-2 sample items>",
      "lineItems": [
        { "name": "<item name as printed on receipt>", "amount": <price> }
      ]
    }
  ]
}

RULES:
- The sum of all item amounts should approximately equal the receipt total (small rounding differences are OK)
- Each description should be short: store name, category, and 1-2 sample items (max 80 chars)
- Each lineItems entry is one product/line from the receipt with its exact name and price
- If an item has quantity > 1, multiply to get the total and use a single lineItems entry
- Minimum 1 category group, maximum ${MAX_BREAKDOWN_GROUPS} category groups
- At most ${MAX_BREAKDOWN_LINE_ITEMS} lineItems in any one group; if a group would exceed that, merge its smallest items into a single "Other items" line
- All amounts must be positive numbers
- Do NOT include tax/service charge as a separate item — distribute proportionally or include in the largest group`;

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

    const result = receiptBreakdownResultSchema.safeParse(parsed);

    if (!result.success) {
      // Logged for the same reason scanReceipt logs it: a silent rejection surfaces to the user
      // as a flat 422 and to the operator as nothing at all. Capped, since the issue list carries
      // one entry per bad line item.
      console.warn(
        "[receipts/breakdown] response failed validation:",
        result.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ") + (result.error.issues.length > 5 ? ` (+${result.error.issues.length - 5} more)` : "")
      );
      return await fail("Could not extract item details from this receipt.", 422);
    }

    // Normalize date and flag suspicious year for the UI
    const { date: normalizedDate, dateWarning, usedPhotoFallback: parseFailed } = checkReceiptDate(result.data.date, todayStr, photoDateStr);
    // Trust Gemini's explicit signal first; fall back to parse-failure detection.
    const usedPhotoFallback = result.data.dateSource === "PHOTO_FALLBACK" || parseFailed;
    result.data.date = normalizedDate;

    // Verify each categoryId exists, fall back to "Other" if not
    const categoryIds = new Set(categories.map((c) => c.id));
    const fallbackCategory =
      categories.find((c) => c.name === "Other") ?? categories[0];

    for (const item of result.data.items) {
      if (!categoryIds.has(item.categoryId) && fallbackCategory) {
        item.categoryId = fallbackCategory.id;
      }
    }

    // Only an itemisation the user can actually use consumes their monthly credit.
    await settleScanReservation(guard.reservationId, "SUCCESS");

    return NextResponse.json({ ...result.data, dateWarning, usedPhotoFallback });
  } catch (error) {
    console.error("[receipts/breakdown] Breakdown failed:", error);
    if (isGeminiUnavailable(error)) {
      return await fail(
        "The AI scanning service is busy right now. Please try again in a minute.",
        503
      );
    }
    return await fail("Failed to break down receipt. Please try again.", 500);
  }
}
