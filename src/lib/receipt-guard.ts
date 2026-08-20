import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reserveScanCredit, type ScanQuotaDenial } from "@/lib/scan-quota";

/** Formats Gemini accepts inline and the client can realistically produce. */
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/** Fallback for when browsers report "" or "application/octet-stream" for HEIC and other formats */
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

/** Ceiling on the whole multipart body, checked before we buffer any of it. Leaves room for
 *  multipart framing on top of a MAX_FILE_SIZE image. */
const MAX_BODY_SIZE = 5 * 1024 * 1024;

/** Strip markdown code fences that Gemini sometimes wraps around JSON */
export const stripCodeFences = (text: string): string =>
  text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

export interface ReceiptScanContext {
  formData: FormData;
  file: File;
  mimeType: string;
  categories: Array<{ id: string; name: string }>;
  categoryList: string;
  timezoneOffset: number;
  reservationId: string;
}

const denialResponse = (denial: ScanQuotaDenial): NextResponse => {
  if (denial.reason === "RATE_LIMITED") {
    return NextResponse.json(
      { error: "Too many scans in a short time. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(denial.retryAfterSeconds) } },
    );
  }
  return NextResponse.json(
    {
      error: `Monthly scan limit reached (${denial.used}/${denial.limit}). Limit resets next month.`,
    },
    { status: 403 },
  );
};

/**
 * Shared entry guard for both receipt routes: validates the upload, enforces scan
 * permissions, and atomically reserves one scan credit.
 *
 * Both routes previously carried their own copy of this preamble, which had already
 * drifted (one computed the quota month in server-local time, the other in UTC).
 *
 * On success the caller owns the returned `reservationId` and MUST settle it via
 * `settleScanReservation`.
 */
export async function guardReceiptRequest(
  request: Request,
  userId: string,
): Promise<NextResponse | ReceiptScanContext> {
  // Reject oversized bodies before request.formData() buffers them into memory.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 4 MB." },
      { status: 413 },
    );
  }

  const [user, categories] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, receiptScanEnabled: true, timezoneOffset: true },
    }),
    prisma.category.findMany({
      where: { type: "EXPENSE", OR: [{ isDefault: true }, { userId }] },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  // Sessions are JWTs, so a deleted account keeps a valid token until it expires.
  // Previously a null user skipped the whole permission block instead of being rejected.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The user's own Profile > Features toggle, which the API never used to check.
  if (!user.receiptScanEnabled) {
    return NextResponse.json(
      { error: "Receipt scanning is turned off for your account." },
      { status: 403 },
    );
  }

  const isAdmin = user.role === "ADMIN";
  let monthlyScanLimit = 0; // 0 = unlimited, matching AppSettings

  if (!isAdmin) {
    const roleSettings = await prisma.appSettings.findUnique({ where: { role: user.role } });
    if (!roleSettings?.receiptScanEnabled) {
      return NextResponse.json(
        { error: "Receipt scanning is not available for your account." },
        { status: 403 },
      );
    }
    monthlyScanLimit = roleSettings.monthlyScanLimit;
  }

  const formData = await request.formData();
  const file = formData.get("receipt");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No receipt image provided" }, { status: 400 });
  }

  const mimeType = resolveMimeType(file);
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json(
      { error: "Invalid file type. Please upload a JPEG, PNG, WebP, or HEIC image." },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File too large. Maximum size is 4 MB." }, { status: 400 });
  }

  // Reserved last, so a rejected upload never consumes a credit.
  const reservation = await reserveScanCredit(userId, monthlyScanLimit, user.timezoneOffset);
  if (!reservation.ok) {
    return denialResponse(reservation.denial);
  }

  return {
    formData,
    file,
    mimeType,
    categories,
    categoryList: categories.map((c) => `- "${c.name}" (id: "${c.id}")`).join("\n"),
    timezoneOffset: user.timezoneOffset,
    reservationId: reservation.reservationId,
  };
}
