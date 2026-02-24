import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import { getAuthUserId } from "@/lib/session";
import { receiptScanResultSchema } from "@/lib/validations";
import { formatDateInput } from "@/lib/utils";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

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

    if (user && user.role !== "ADMIN") {
      const roleSettings = await prisma.appSettings.findUnique({
        where: { role: user.role },
      });
      if (!roleSettings?.receiptScanEnabled) {
        return NextResponse.json(
          { error: "Receipt scanning is not available for your account." },
          { status: 403 }
        );
      }
    }
    const formData = await request.formData();
    const file = formData.get("receipt");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No receipt image provided" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a JPEG, PNG, or WebP image." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 4 MB." },
        { status: 400 }
      );
    }

    // Fetch user's expense categories (default + custom)
    const categories = await prisma.category.findMany({
      where: {
        type: "EXPENSE",
        OR: [{ isDefault: true }, { userId }],
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true },
    });

    const categoryList = categories
      .map((c) => `- "${c.name}" (id: "${c.id}")`)
      .join("\n");

    const todayStr = formatDateInput(new Date());

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const prompt = `Extract transaction data from this receipt image.

If the image is NOT a receipt (e.g. a random photo, screenshot, or document), respond with exactly: {"error": "NOT_A_RECEIPT"}

Return a JSON object with these fields:
- "amount": the grand total / total due including tax, tips, and service charges (number). Use the largest final amount on the receipt.
- "categoryId": pick the best category ID using the rules below.
- "date": transaction date as "YYYY-MM-DDTHH:mm". If unreadable, use "${todayStr}".
- "description": merchant name + short summary of purchase (max 100 chars).

CATEGORIES:
${categoryList}

CATEGORY RULES (pick categoryId by matching the merchant/items to these rules):
1. Food & Dining: restaurants, cafes, hawker stalls, food courts, bakeries, fast food, coffee shops, bubble tea, food delivery, supermarkets, grocery stores, wet markets, seafood markets, butchers, convenience stores (7-Eleven, FairPrice, Cold Storage)
2. Transportation: ride-hailing (Grab, Gojek), taxis, MRT/bus top-ups, parking, fuel/petrol, tolls
3. Shopping: clothing, electronics, department stores, online shopping (Shopee, Lazada, Amazon)
4. Bills & Utilities: electricity, water, gas, internet, phone bills, subscriptions (Netflix, Spotify)
5. Entertainment: movies, concerts, theme parks, games, sports, streaming services
6. Healthcare: doctors, clinics, pharmacies, dental, hospital, health supplements
7. For any category not listed above, match by comparing the merchant/items to the category name.
8. When in doubt, prefer "Food & Dining" if the merchant sells any food or beverages.

Respond with ONLY valid JSON, no markdown or explanation:
{"amount": <number>, "categoryId": "<id>", "date": "<datetime>", "description": "<text>"}`;

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: file.type,
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
    const validCategory = categories.find((c) => c.id === result.data.categoryId);
    if (!validCategory) {
      // Fall back to "Other Expense" or first available category
      const fallback =
        categories.find((c) => c.name === "Other") ?? categories[0];
      if (fallback) {
        result.data.categoryId = fallback.id;
      }
    }

    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json(
      { error: "Failed to scan receipt. Please try again." },
      { status: 500 }
    );
  }
}
