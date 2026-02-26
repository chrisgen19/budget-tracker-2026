import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import { getAuthUserId } from "@/lib/session";
import { receiptScanResultSchema } from "@/lib/validations";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/** Fallback map for when browsers report "" or "application/octet-stream" for HEIC and other formats */
const EXTENSION_MIME_MAP: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Resolve a reliable MIME type — uses file.type when valid, otherwise falls back to extension lookup */
const resolveMimeType = (file: File): string => {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_MAP[ext] ?? file.type;
};

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB

/** Strip markdown code fences that Gemini sometimes wraps around JSON */
const stripCodeFences = (text: string): string =>
  text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    // Check role-based scan permission
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    // Parse form data while role check runs its course
    const formData = await request.formData();
    const file = formData.get("receipt");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No receipt image provided" },
        { status: 400 }
      );
    }

    const mimeType = resolveMimeType(file);
    if (!ALLOWED_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a JPEG, PNG, WebP, or HEIC image." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 4 MB." },
        { status: 400 }
      );
    }

    // Run permission checks + category fetch in parallel
    const isAdmin = user?.role === "ADMIN";
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [roleSettings, scansThisMonth, categories] = await Promise.all([
      // Only fetch settings for non-admins
      !isAdmin && user
        ? prisma.appSettings.findUnique({ where: { role: user.role } })
        : null,
      // Only count scans for non-admins
      !isAdmin
        ? prisma.scanLog.count({
            where: { userId, createdAt: { gte: monthStart } },
          })
        : 0,
      // Always fetch categories (needed for Gemini prompt)
      prisma.category.findMany({
        where: {
          type: "EXPENSE",
          OR: [{ isDefault: true }, { userId }],
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
    ]);

    // Enforce role-based scan permissions for non-admins
    if (!isAdmin && user) {
      if (!roleSettings?.receiptScanEnabled) {
        return NextResponse.json(
          { error: "Receipt scanning is not available for your account." },
          { status: 403 }
        );
      }

      // Enforce monthly scan limit (0 = unlimited)
      if (
        roleSettings.monthlyScanLimit > 0 &&
        scansThisMonth >= roleSettings.monthlyScanLimit
      ) {
        return NextResponse.json(
          {
            error: `Monthly scan limit reached (${scansThisMonth}/${roleSettings.monthlyScanLimit}). Limit resets next month.`,
          },
          { status: 403 }
        );
      }
    }

    const categoryList = categories
      .map((c) => `- "${c.name}" (id: "${c.id}")`)
      .join("\n");

    // Date-only fallback — time is appended on the client using the user's local clock
    const todayStr = new Date().toISOString().slice(0, 10);

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const prompt = `Extract transaction data from this receipt image.

If the image is NOT a receipt (e.g. a random photo, screenshot, or document), respond with exactly: {"error": "NOT_A_RECEIPT"}

Return a JSON object with these fields:
- "amount": the grand total / total due including tax, tips, and service charges (number). Use the largest final amount on the receipt.
- "categoryId": pick the best category ID using the rules below.
- "date": transaction date as "YYYY-MM-DD" (date only, no time). If the date is unreadable, use "${todayStr}".
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
{"amount": <number>, "categoryId": "<id>", "date": "<YYYY-MM-DD>", "description": "<text>", "multiCategory": <boolean>}
or when multiCategory is true:
{"amount": <number>, "categoryId": "<id>", "date": "<YYYY-MM-DD>", "description": "<text>", "multiCategory": true, "breakdown": [{"amount": <number>, "categoryId": "<id>", "description": "<text>", "lineItems": [{"name": "<text>", "amount": <number>}]}]}`;

    const response = await gemini.models.generateContent({
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
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      return NextResponse.json(
        { error: "Could not read the receipt. Please try a clearer photo." },
        { status: 422 }
      );
    }

    const cleanJson = stripCodeFences(rawText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      return NextResponse.json(
        { error: "Could not read the receipt. Please try a clearer photo." },
        { status: 422 }
      );
    }

    // Handle non-receipt images
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      (parsed as Record<string, unknown>).error === "NOT_A_RECEIPT"
    ) {
      return NextResponse.json(
        { error: "This doesn't look like a receipt. Please upload a receipt image." },
        { status: 422 }
      );
    }

    const result = receiptScanResultSchema.safeParse({
      ...(parsed as Record<string, unknown>),
      type: "EXPENSE",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: "Could not extract transaction details from this receipt." },
        { status: 422 }
      );
    }

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

    // Log successful scan for monthly limit tracking (fire-and-forget)
    prisma.scanLog.create({ data: { userId } }).catch(() => {});

    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json(
      { error: "Failed to scan receipt. Please try again." },
      { status: 500 }
    );
  }
}
