import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { getReceiptPhotoInfo } from "@/lib/receipt-photos";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  try {
    const info = await getReceiptPhotoInfo(prisma, userId, id);
    if (!info) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
    return NextResponse.json(info);
  } catch {
    return NextResponse.json({ error: "Failed to load the photo." }, { status: 500 });
  }
}
