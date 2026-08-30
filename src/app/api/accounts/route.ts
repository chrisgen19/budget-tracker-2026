import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { accountSchema } from "@/lib/validations";
import { getAccountBalances } from "@/lib/account-balances";
import { timezoneOffsetParam } from "@/lib/validations";

/**
 * Every account with its derived balance.
 *
 * Balances are never stored, so this is the only way to read one — see `getAccountBalances` for
 * why. `includeInactive` brings back archived accounts, which the accounts page offers behind a
 * toggle: an archived card usually still has history worth looking at.
 */
export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const tz = timezoneOffsetParam.safeParse(searchParams.get("tz"));

  const balances = await getAccountBalances(prisma, userId, {
    includeInactive: searchParams.get("includeInactive") === "true",
    asOf: searchParams.get("asOf") ?? undefined,
    timezoneOffset: tz.success ? tz.data : 0,
  });

  return NextResponse.json(balances);
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = accountSchema.parse(body);

    // Checked before inserting so the collision reads as a field error rather than a 500 from the
    // (userId, name) unique index. The index is still what guarantees it under a double submit.
    const existing = await prisma.account.findFirst({
      where: { userId, name: validated.name },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this name already exists" },
        { status: 400 }
      );
    }

    const account = await prisma.account.create({
      data: {
        userId,
        name: validated.name,
        type: validated.type,
        openingBalance: validated.openingBalance,
        creditLimit: validated.creditLimit ?? null,
        color: validated.color,
        icon: validated.icon,
      },
    });

    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
