import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import {
  createPhotoStorage,
  PhotoNotFoundError,
  PhotoStorageError,
  receiptPhotosEnabled,
} from "@/lib/receipt-photo-storage";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const fail = (error: string, status: number, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status });

export async function GET(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  if (!receiptPhotosEnabled()) {
    return fail("Receipt photos are not enabled.", 503, "PHOTOS_DISABLED");
  }

  const { id } = await params;
  const photo = await prisma.receiptPhoto.findFirst({
    where: { id, userId },
    select: { objectKey: true },
  });
  if (!photo) return fail("Photo not found.", 404);

  try {
    const res = await createPhotoStorage().get(photo.objectKey);
    return new NextResponse(res.body, {
      status: 200,
      headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof PhotoNotFoundError) return fail("Photo not found.", 404);
    if (error instanceof PhotoStorageError) return fail("Photo storage failed.", 502);
    return fail("Failed to load the photo.", 500);
  }
}
