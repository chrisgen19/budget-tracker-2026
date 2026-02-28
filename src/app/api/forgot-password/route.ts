import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forgotPasswordSchema } from "@/lib/validations";
import { createVerificationToken, hasRecentToken } from "@/lib/tokens";
import { sendPasswordResetEmail } from "@/lib/email";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json(
      { message: "If an account exists with that email, we've sent a password reset link." },
      { status: 200 }
    );

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.emailVerified) {
      return successResponse;
    }

    // Rate limit: one reset email per 5 minutes
    const recentlySent = await hasRecentToken(user.id, "PASSWORD_RESET", 5);
    if (recentlySent) {
      return successResponse;
    }

    const tokenRecord = await createVerificationToken(user.id, "PASSWORD_RESET");
    await sendPasswordResetEmail(email, tokenRecord.token);

    return successResponse;
  } catch {
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
