import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateToken, deleteToken } from "@/lib/tokens";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(
      new URL("/login?error=missing-token", request.url)
    );
  }

  const record = await validateToken(token, "EMAIL_VERIFICATION");

  if (!record) {
    return NextResponse.redirect(
      new URL("/login?error=invalid-token", request.url)
    );
  }

  await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerified: true },
  });

  await deleteToken(record.id);

  return NextResponse.redirect(new URL("/login?verified=true", request.url));
}
