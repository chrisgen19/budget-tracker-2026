import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forgotPasswordSchema } from "@/lib/validations";
import { createVerificationToken, hasRecentToken } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Reuse forgotPasswordSchema since it's the same shape: { email }
    const { email } = forgotPasswordSchema.parse(body);

    const successResponse = NextResponse.json(
      { message: "If your account needs verification, we've sent a new link." },
      { status: 200 }
    );

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.emailVerified) {
      return successResponse;
    }

    // Rate limit: one verification email per 2 minutes
    const recentlySent = await hasRecentToken(user.id, "EMAIL_VERIFICATION", 2);
    if (recentlySent) {
      return NextResponse.json(
        { error: "Please wait a couple of minutes before requesting another email." },
        { status: 429 }
      );
    }

    const tokenRecord = await createVerificationToken(user.id, "EMAIL_VERIFICATION");
    await sendVerificationEmail(email, tokenRecord.token);

    return successResponse;
  } catch {
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
