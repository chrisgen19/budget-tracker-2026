import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import { getAuthUserId } from "@/lib/session";
import { receiptBreakdownResultSchema } from "@/lib/validations";
import { formatDateInput } from "@/lib/utils";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const EXTENSION_MIME_MAP: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

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

    const isAdmin = user?.role === "ADMIN";
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [roleSettings, scansThisMonth, categories] = await Promise.all([
      !isAdmin && user
        ? prisma.appSettings.findUnique({ where: { role: user.role } })
        : null,
      !isAdmin
        ? prisma.scanLog.count({
            where: { userId, createdAt: { gte: monthStart } },
          })
        : 0,
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

    const todayStr = formatDateInput(new Date());

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
  "date": "<YYYY-MM-DDTHH:mm — receipt date, or ${todayStr} if unreadable>",
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
- Minimum 1 category group, maximum 20 category groups
- All amounts must be positive numbers
- Do NOT include tax/service charge as a separate item — distribute proportionally or include in the largest group`;

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

    const result = receiptBreakdownResultSchema.safeParse(parsed);

    if (!result.success) {
      return NextResponse.json(
        { error: "Could not extract item details from this receipt." },
        { status: 422 }
      );
    }

    // Verify each categoryId exists, fall back to "Other" if not
    const categoryIds = new Set(categories.map((c) => c.id));
    const fallbackCategory =
      categories.find((c) => c.name === "Other") ?? categories[0];

    for (const item of result.data.items) {
      if (!categoryIds.has(item.categoryId) && fallbackCategory) {
        item.categoryId = fallbackCategory.id;
      }
    }

    // Log 1 scan credit for the breakdown (fire-and-forget)
    prisma.scanLog.create({ data: { userId } }).catch(() => {});

    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json(
      { error: "Failed to break down receipt. Please try again." },
      { status: 500 }
    );
  }
}
