import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { createCreditChargesSchema } from "@/lib/validations";
import { readTimezoneOffset } from "@/lib/credit-account-queries";
import { createCreditCharges } from "@/lib/credit-account-writes";
import {
  creditFailureResponse,
  creditRouteIdSchema,
  invalidInputResponse,
} from "@/lib/credit-account-http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const accountId = creditRouteIdSchema.parse((await params).id);
    const { charges } = createCreditChargesSchema.parse(await request.json());
    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const result = await createCreditCharges({
      prisma,
      userId,
      accountId,
      items: charges,
      timezoneOffset,
    });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json({ charges: result.charges }, { status: 201 });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to add charges" }, { status: 500 })
    );
  }
}
