import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { creditAccountPatchSchema } from "@/lib/validations";
import {
  currentMonthKey,
  getCreditAccountDetail,
  readTimezoneOffset,
} from "@/lib/credit-account-queries";
import { deleteCreditAccount, updateCreditAccount } from "@/lib/credit-account-writes";
import {
  creditFailureResponse,
  creditRouteIdSchema,
  invalidInputResponse,
} from "@/lib/credit-account-http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const id = creditRouteIdSchema.parse((await params).id);
    const requested = new URL(request.url).searchParams.get("month");
    // A malformed month is refused rather than quietly replaced with this one, which would answer
    // a question nobody asked in the same shape as the one they did.
    if (requested !== null && !MONTH.test(requested)) {
      return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
    }

    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const month = requested ?? currentMonthKey(timezoneOffset);
    const detail = await getCreditAccountDetail(prisma, userId, id, month, timezoneOffset);
    if (!detail) return creditFailureResponse("NOT_FOUND");

    return NextResponse.json(detail);
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to load credit card" }, { status: 500 })
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const accountId = creditRouteIdSchema.parse((await params).id);
    const patch = creditAccountPatchSchema.parse(await request.json());
    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const result = await updateCreditAccount({ prisma, userId, accountId, patch, timezoneOffset });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json(result.account);
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to update credit card" }, { status: 500 })
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const accountId = creditRouteIdSchema.parse((await params).id);
    const result = await deleteCreditAccount({ prisma, userId, accountId });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json({ outcome: result.outcome });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to delete credit card" }, { status: 500 })
    );
  }
}
