import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { creditChargePatchSchema } from "@/lib/validations";
import { readTimezoneOffset } from "@/lib/credit-account-queries";
import { deleteCreditCharge, updateCreditCharge } from "@/lib/credit-account-writes";
import {
  creditFailureResponse,
  creditRouteIdSchema,
  invalidInputResponse,
} from "@/lib/credit-account-http";

interface RouteParams {
  params: Promise<{ id: string; chargeId: string }>;
}

const parseIds = async (params: RouteParams["params"]) => {
  const { id, chargeId } = await params;
  return { accountId: creditRouteIdSchema.parse(id), chargeId: creditRouteIdSchema.parse(chargeId) };
};

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { accountId, chargeId } = await parseIds(params);
    const patch = creditChargePatchSchema.parse(await request.json());
    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const result = await updateCreditCharge({
      prisma,
      userId,
      accountId,
      chargeId,
      patch,
      timezoneOffset,
    });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json(result.charge);
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to update charge" }, { status: 500 })
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { accountId, chargeId } = await parseIds(params);
    const result = await deleteCreditCharge({ prisma, userId, accountId, chargeId });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json({ message: "Charge deleted" });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to delete charge" }, { status: 500 })
    );
  }
}
