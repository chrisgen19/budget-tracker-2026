import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { ALLOWED_TYPES, checkBodySize, resolveMimeType } from "@/lib/receipt-guard";
import { MAX_FILE_SIZE } from "@/lib/receipt-limits";
import { looksLikeHeicBytes } from "@/lib/heic";
import { UnreadableImageError } from "@/lib/receipt-photo-image";
import {
  createPhotoStorage,
  PhotoStorageError,
  receiptPhotosEnabled,
} from "@/lib/receipt-photo-storage";
import { storeReceiptPhoto } from "@/lib/receipt-photos";

const photoKeySchema = z.string().uuid();

const fail = (error: string, status: number, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status });

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  if (!receiptPhotosEnabled()) {
    return fail("Receipt photos are not enabled.", 503, "PHOTOS_DISABLED");
  }
  const tooLarge = checkBodySize(request);
  if (tooLarge) return tooLarge;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail("Invalid form data.", 400);
  }
  const file = formData.get("photo");
  const photoKey = photoKeySchema.safeParse(formData.get("photoKey"));
  if (!(file instanceof File) || !photoKey.success) {
    return fail("A photo and a photoKey (UUID) are required.", 400);
  }
  if (!ALLOWED_TYPES.has(resolveMimeType(file))) {
    return fail("Unsupported file type.", 415);
  }
  if (file.size > MAX_FILE_SIZE) return fail("File too large. Maximum size is 4 MB.", 413);

  let bytes: Uint8Array = new Uint8Array();
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    const { photo, replayed } = await storeReceiptPhoto(
      { prisma, storage: createPhotoStorage() },
      { userId, photoKey: photoKey.data, bytes },
    );
    return NextResponse.json({ photo }, { status: replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof UnreadableImageError) {
      // The sharp build decodes HEIF for AVIF only, so a HEIC upload always lands here.
      const mime = resolveMimeType(file);
      if (mime === "image/heic" || mime === "image/heif" || looksLikeHeicBytes(bytes)) {
        return fail("HEIC photos aren't supported. Send a JPEG or PNG.", 415);
      }
      return fail("That file isn't a readable image.", 422);
    }
    if (error instanceof PhotoStorageError) return fail("Photo storage failed.", 502);
    return fail("Failed to save the photo.", 500);
  }
}
