import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { creditAccountSchema } from "@/lib/validations";
import { getCreditAccountSummaries, readTimezoneOffset } from "@/lib/credit-account-queries";
import { createCreditAccount } from "@/lib/credit-account-writes";
import {
  creditFailureResponse,
  invalidInputResponse,
  requireCreditCardsUser,
} from "@/lib/credit-account-http";

export async function GET(request: Request) {
  const userId = await requireCreditCardsUser();
  if (userId instanceof NextResponse) return userId;

  try {
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const accounts = await getCreditAccountSummaries(prisma, userId, { includeArchived });
    return NextResponse.json(accounts);
  } catch {
    return NextResponse.json({ error: "Failed to load credit cards" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await requireCreditCardsUser();
  if (userId instanceof NextResponse) return userId;

  try {
    const input = creditAccountSchema.parse(await request.json());
    const timezoneOffset = await readTimezoneOffset(prisma, userId);
    const result = await createCreditAccount({ prisma, userId, input, timezoneOffset });
    if (!result.ok) return creditFailureResponse(result.reason);

    return NextResponse.json(result.account, { status: 201 });
  } catch (error) {
    return (
      invalidInputResponse(error) ??
      NextResponse.json({ error: "Failed to create credit card" }, { status: 500 })
    );
  }
}
