import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reserveScanCredit } from "@/lib/scan-quota";

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
export const resolveMimeType = (file: File): string => {
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

/**
 * Why a scan was refused, independent of how the caller reports it.
 *
 * The route maps these to status codes and the MCP tool maps them to prose. They used to exist
 * only as `NextResponse` objects, which is what stopped anything but a route handler using this
 * guard at all.
 */
export type ScanRefusal =
  | { reason: "UNAUTHORIZED" }
  /** `scope` separates the user's own Profile toggle from the role-level setting. The client
   *  mirrors an exhausted allowance locally and must not do that when it is merely switched off. */
  | { reason: "SCAN_DISABLED"; scope: "USER" | "ROLE" }
  | { reason: "INVALID_TYPE" }
  | { reason: "TOO_LARGE" }
  | { reason: "LIMIT_REACHED"; used: number; limit: number }
  | { reason: "RATE_LIMITED"; retryAfterSeconds: number };

export type ScanAuthorization =
  | { ok: true; context: AuthorizedScan }
  | { ok: false; refusal: ScanRefusal };

/** What a caller needs once a scan is authorized and a credit is held. */
export interface AuthorizedScan {
  categories: Array<{ id: string; name: string }>;
  categoryList: string;
  timezoneOffset: number;
  reservationId: string;
}

export interface ReceiptScanContext {
  formData: FormData;
  file: File;
  mimeType: string;
  categories: Array<{ id: string; name: string }>;
  categoryList: string;
  timezoneOffset: number;
  reservationId: string;
}

interface ScanPermissions {
  monthlyScanLimit: number;
  timezoneOffset: number;
  categories: Array<{ id: string; name: string }>;
}

/** Reject oversized bodies before request.formData() buffers them into memory. */
export const checkBodySize = (request: Request): NextResponse | null => {
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "File too large. Maximum size is 4 MB." }, { status: 413 });
  }
  return null;
};

/** Resolve whether this user may scan at all, and under what monthly allowance. */
async function resolveScanPermissions(userId: string): Promise<ScanRefusal | ScanPermissions> {
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
  if (!user) return { reason: "UNAUTHORIZED" };

  // The user's own Profile > Features toggle, which the API never used to check.
  if (!user.receiptScanEnabled) return { reason: "SCAN_DISABLED", scope: "USER" };

  if (user.role === "ADMIN") {
    return { monthlyScanLimit: 0, timezoneOffset: user.timezoneOffset, categories };
  }

  const roleSettings = await prisma.appSettings.findUnique({ where: { role: user.role } });
  if (!roleSettings?.receiptScanEnabled) return { reason: "SCAN_DISABLED", scope: "ROLE" };

  return {
    monthlyScanLimit: roleSettings.monthlyScanLimit,
    timezoneOffset: user.timezoneOffset,
    categories,
  };
}

/**
 * Shared entry guard for both receipt routes: validates the upload, enforces scan
 * permissions, and atomically reserves one scan credit.
 *
 * Both routes previously carried their own copy of this preamble, which had already
 * drifted (one computed the quota month in server-local time, the other in UTC).
 *
 * Callers must invoke this inside their handler's try/catch: it performs I/O that can
 * reject. On success the caller owns the returned `reservationId` and MUST settle it via
 * `settleScanReservation`. Nothing after the reservation can throw, so a rejection here
 * never strands a credit.
 */
export async function authorizeReceiptScan(params: {
  userId: string;
  mimeType: string;
  byteLength: number;
}): Promise<ScanAuthorization> {
  // Permission first, then the file. The routes have always answered "you may not scan" ahead of
  // "that file is wrong", and a caller with neither should keep seeing the former.
  const permissions = await resolveScanPermissions(params.userId);
  if ("reason" in permissions) return { ok: false, refusal: permissions };

  if (!ALLOWED_TYPES.has(params.mimeType)) return { ok: false, refusal: { reason: "INVALID_TYPE" } };
  if (params.byteLength > MAX_FILE_SIZE) return { ok: false, refusal: { reason: "TOO_LARGE" } };

  // Reserved last, so a rejected upload never consumes a credit.
  const reservation = await reserveScanCredit(
    params.userId,
    permissions.monthlyScanLimit,
    permissions.timezoneOffset,
  );
  if (!reservation.ok) {
    const d = reservation.denial;
    return {
      ok: false,
      refusal:
        d.reason === "RATE_LIMITED"
          ? { reason: "RATE_LIMITED", retryAfterSeconds: d.retryAfterSeconds }
          : { reason: "LIMIT_REACHED", used: d.used, limit: d.limit },
    };
  }

  return {
    ok: true,
    context: {
      categories: permissions.categories,
      categoryList: permissions.categories.map((c) => `- "${c.name}" (id: "${c.id}")`).join("\n"),
      timezoneOffset: permissions.timezoneOffset,
      reservationId: reservation.reservationId,
    },
  };
}

/** Map a refusal to the HTTP shape both receipt routes have always returned. */
export const refusalResponse = (refusal: ScanRefusal): NextResponse => {
  switch (refusal.reason) {
    case "UNAUTHORIZED":
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    case "SCAN_DISABLED":
      return NextResponse.json(
        {
          error:
            refusal.scope === "USER"
              ? "Receipt scanning is turned off for your account."
              : "Receipt scanning is not available for your account.",
          code: "SCAN_DISABLED",
        },
        { status: 403 },
      );
    case "INVALID_TYPE":
      return NextResponse.json(
        { error: "Invalid file type. Please upload a JPEG, PNG, WebP, or HEIC image." },
        { status: 400 },
      );
    case "TOO_LARGE":
      return NextResponse.json({ error: "File too large. Maximum size is 4 MB." }, { status: 400 });
    case "RATE_LIMITED":
      return NextResponse.json(
        {
          error: "Too many scans in a short time. Please wait a few minutes and try again.",
          code: "RATE_LIMITED",
        },
        { status: 429, headers: { "Retry-After": String(refusal.retryAfterSeconds) } },
      );
    case "LIMIT_REACHED":
      return NextResponse.json(
        {
          error: `Monthly scan limit reached (${refusal.used}/${refusal.limit}). Limit resets next month.`,
          // Three different conditions return 403 here. The client mirrors the exhausted
          // allowance locally, and must not do that when the feature is merely switched off.
          code: "LIMIT_REACHED",
        },
        { status: 403 },
      );
  }
};

/**
 * HTTP wrapper around `authorizeReceiptScan` for the two receipt routes.
 *
 * The multipart parsing and the status codes stay here; the decision itself moved to
 * `authorizeReceiptScan` so the MCP tool can reach it without fabricating a `Request`.
 */
export async function guardReceiptRequest(
  request: Request,
  userId: string,
): Promise<NextResponse | ReceiptScanContext> {
  const oversized = checkBodySize(request);
  if (oversized) return oversized;

  const formData = await request.formData();
  const file = formData.get("receipt");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No receipt image provided" }, { status: 400 });
  }
  const mimeType = resolveMimeType(file);

  const auth = await authorizeReceiptScan({ userId, mimeType, byteLength: file.size });
  if (!auth.ok) return refusalResponse(auth.refusal);

  return { formData, file, mimeType, ...auth.context };
}
