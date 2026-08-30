import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { accountSchema } from "@/lib/validations";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const existing = await prisma.account.findFirst({ where: { id, userId } });
    if (!existing) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const body = await request.json();
    const validated = accountSchema.parse(body);

    const duplicate = await prisma.account.findFirst({
      where: { userId, name: validated.name, id: { not: id } },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "An account with this name already exists" },
        { status: 400 }
      );
    }

    const account = await prisma.account.update({
      where: { id },
      data: {
        name: validated.name,
        type: validated.type,
        openingBalance: validated.openingBalance,
        // Cleared when the type changes away from a card, so a stale limit cannot linger and be
        // presented as headroom on an account that has none.
        creditLimit: validated.type === "CREDIT_CARD" ? validated.creditLimit ?? null : null,
        color: validated.color,
        icon: validated.icon,
        isActive: validated.isActive,
      },
    });

    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

/**
 * Archive an account, or permanently delete one that never carried a transaction.
 *
 * Archiving is the default because `Transaction.accountId` is `SetNull`: deleting an account that
 * has history would silently detach every row from it, changing balances and losing which card a
 * purchase was on, with nothing to undo it from. An account with no rows has no history to lose,
 * so a mistyped account created a minute ago can still be removed outright.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.account.findFirst({ where: { id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const referencing = await prisma.transaction.count({
    where: { userId, OR: [{ accountId: id }, { transferAccountId: id }] },
  });

  if (referencing > 0) {
    const account = await prisma.account.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ archived: true, transactionCount: referencing, account });
  }

  await prisma.account.delete({ where: { id } });
  return NextResponse.json({ archived: false, transactionCount: 0 });
}
