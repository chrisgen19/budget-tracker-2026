import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { readTimezoneOffset } from "@/lib/credit-account-queries";
import { createCardReminder, removeCardReminder } from "@/lib/credit-account-writes";
import {
  creditFailureResponse,
  creditRouteIdSchema,
  invalidInputResponse,
} from "@/lib/credit-account-http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const accountId = creditRouteIdSchema.parse((await params).id);
    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const result = await createCardReminder({ prisma, userId, accountId, timezoneOffset });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json({ billId: result.billId }, { status: 201 });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to create the reminder" }, { status: 500 })
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const accountId = creditRouteIdSchema.parse((await params).id);
    const result = await removeCardReminder({ prisma, userId, accountId });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json({ message: "Reminder unlinked" });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to unlink the reminder" }, { status: 500 })
    );
  }
}
