import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateToken, deleteToken } from "@/lib/tokens";

const getBaseUrl = () => {
  return process.env.NEXTAUTH_URL || "http://localhost:3000";
};

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const baseUrl = getBaseUrl();

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing-token`);
  }

  const record = await validateToken(token, "EMAIL_VERIFICATION");

  if (!record) {
    return NextResponse.redirect(`${baseUrl}/login?error=invalid-token`);
  }

  await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerified: true },
  });

  await deleteToken(record.id);

  return NextResponse.redirect(`${baseUrl}/login?verified=true`);
}
