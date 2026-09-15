import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { creditPaymentSchema } from "@/lib/validations";
import { readTimezoneOffset } from "@/lib/credit-account-queries";
import { createCreditPayment } from "@/lib/credit-account-writes";
import {
  creditFailureResponse,
  creditRouteIdSchema,
  invalidInputResponse,
  requireCreditCardsUser,
} from "@/lib/credit-account-http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const userId = await requireCreditCardsUser();
  if (userId instanceof NextResponse) return userId;

  try {
    const accountId = creditRouteIdSchema.parse((await params).id);
    const input = creditPaymentSchema.parse(await request.json());
    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const result = await createCreditPayment({ prisma, userId, accountId, input, timezoneOffset });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json(result.payment, { status: 201 });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to record the payment" }, { status: 500 })
    );
  }
}
