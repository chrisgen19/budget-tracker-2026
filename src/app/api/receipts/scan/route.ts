import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/session";
import { parseLocalDate } from "@/lib/receipt-date";
import { checkBodySize, refusalResponse, resolveMimeType } from "@/lib/receipt-guard";
import { scanReceipt, type ScanFailure } from "@/lib/receipt-scan";

/** The status and wording each post-authorization failure has always returned. */
const FAILURE_RESPONSES: Record<ScanFailure["reason"], { message: string; status: number }> = {
  NOT_A_RECEIPT: {
    message: "This doesn't look like a receipt. Please upload a receipt image.",
    status: 422,
  },
  UNREADABLE: { message: "Could not read the receipt. Please try a clearer photo.", status: 422 },
  AI_UNAVAILABLE: {
    message: "The AI scanning service is busy right now. Please try again in a minute.",
    status: 503,
  },
  FAILED: { message: "Failed to scan receipt. Please try again.", status: 500 },
};

/**
 * Scan one receipt image for the web app.
 *
 * The scan itself lives in `src/lib/receipt-scan.ts`, shared with the MCP `scan_receipt` tool.
 * This handler owns only what is specific to HTTP: multipart parsing, the client-supplied local
 * and photo dates, and the status codes.
 */
export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  // Rejected before request.formData() buffers the body into memory.
  const oversized = checkBodySize(request);
  if (oversized) return oversized;

  try {
    const formData = await request.formData();
    const file = formData.get("receipt");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No receipt image provided" }, { status: 400 });
    }

    // Date-only fallback — prefer client's local date to avoid UTC offset issues.
    // Calendar-valid (rejects e.g. "2024-13-40") to keep server output trustworthy.
    const serverToday = new Date().toISOString().slice(0, 10);
    const todayStr = parseLocalDate(formData.get("localDate"), serverToday);
    // Photo capture date from the original (uncompressed) File on the client. Used as the
    // fallback when Gemini's date is unreadable or has a wrong year.
    const photoDateStr = parseLocalDate(formData.get("photoDate"), todayStr);

    const outcome = await scanReceipt({
      userId,
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      mimeType: resolveMimeType(file),
      byteLength: file.size,
      todayStr,
      photoDateStr,
    });

    if ("refusal" in outcome) return refusalResponse(outcome.refusal);
    if (!outcome.ok) {
      const { message, status } = FAILURE_RESPONSES[outcome.failure.reason];
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json(outcome.result);
  } catch (error) {
    // Reaching here means the body itself could not be read; nothing was reserved, because
    // scanReceipt settles its own credit on every path.
    console.error("[receipts/scan] request failed:", error);
    return NextResponse.json({ error: "Failed to scan receipt. Please try again." }, { status: 500 });
  }
}
