import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { creditPaymentPatchSchema } from "@/lib/validations";
import { readTimezoneOffset } from "@/lib/credit-account-queries";
import { deleteCreditPayment, updateCreditPayment } from "@/lib/credit-account-writes";
import {
  creditFailureResponse,
  creditRouteIdSchema,
  invalidInputResponse,
} from "@/lib/credit-account-http";

interface RouteParams {
  params: Promise<{ id: string; paymentId: string }>;
}

const parseIds = async (params: RouteParams["params"]) => {
  const { id, paymentId } = await params;
  return {
    accountId: creditRouteIdSchema.parse(id),
    paymentId: creditRouteIdSchema.parse(paymentId),
  };
};

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { accountId, paymentId } = await parseIds(params);
    const patch = creditPaymentPatchSchema.parse(await request.json());
    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const result = await updateCreditPayment({
      prisma,
      userId,
      accountId,
      paymentId,
      patch,
      timezoneOffset,
    });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json(result.payment);
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to update the payment" }, { status: 500 })
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { accountId, paymentId } = await parseIds(params);
    const result = await deleteCreditPayment({ prisma, userId, accountId, paymentId });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json({ message: "Payment deleted" });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to delete the payment" }, { status: 500 })
    );
  }
}
