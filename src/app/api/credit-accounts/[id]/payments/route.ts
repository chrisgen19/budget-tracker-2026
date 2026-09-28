import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientBatchIdSchema, creditPaymentCreateSchema } from "@/lib/validations";
import { readTimezoneOffset } from "@/lib/credit-account-queries";
import { createCreditPayment, findSavedCreditPayment } from "@/lib/credit-account-writes";
import {
  creditFailureResponse,
  creditRouteIdSchema,
  invalidInputResponse,
  requireCreditCardsUser,
} from "@/lib/credit-account-http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Record a payment or a refund. 201 when this request saved it, 200 when its `clientRequestId`
 * had already saved one, which is answered with that row.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const userId = await requireCreditCardsUser();
  if (userId instanceof NextResponse) return userId;

  try {
    const accountId = creditRouteIdSchema.parse((await params).id);
    const body: unknown = await request.json();

    // A replay creates nothing, so it is answered before the body is validated, the rule
    // `/api/transactions/batch` follows: a schema tightened since the first attempt must not
    // refuse the retry of a payment it already accepted.
    const key = clientBatchIdSchema.safeParse((body as { clientRequestId?: unknown } | null)?.clientRequestId);
    if (key.success) {
      const saved = await findSavedCreditPayment(prisma, userId, key.data);
      if (saved) return NextResponse.json(saved, { status: 200 });
    }

    const { clientRequestId, ...input } = creditPaymentCreateSchema.parse(body);
    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const result = await createCreditPayment({ prisma, userId, accountId, input, timezoneOffset, clientRequestId });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json(result.payment, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to record the payment" }, { status: 500 })
    );
  }
}
