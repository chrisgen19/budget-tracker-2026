import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hideAmounts: true },
  });

  return NextResponse.json({ hideAmounts: user?.hideAmounts ?? false });
}

export async function PATCH(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json();
  const hideAmounts = Boolean(body.hideAmounts);

  await prisma.user.update({
    where: { id: userId },
    data: { hideAmounts },
  });

  return NextResponse.json({ hideAmounts });
}
