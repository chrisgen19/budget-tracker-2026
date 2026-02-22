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

    const prompt = `You are an OCR assistant that extracts transaction data from receipt images.

Analyze this receipt image and extract the following information:
- **amount**: The total amount paid (number, e.g. 125.50). Use the final/total amount, not subtotals.
- **categoryId**: The best matching category ID from the list below.
- **date**: The transaction date from the receipt in "YYYY-MM-DDTHH:mm" format. If not readable, use "${todayStr}".
- **description**: A brief description — merchant/store name and a short summary of what was purchased (max 100 chars).

Available expense categories:
${categoryList}

Respond with ONLY a JSON object (no markdown, no explanation):
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
