import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      hideAmounts: true,
      quickExpenseCategories: true,
      quickIncomeCategories: true,
    },
  });

  return NextResponse.json({
    hideAmounts: user?.hideAmounts ?? false,
    quickExpenseCategories: user?.quickExpenseCategories ?? [],
    quickIncomeCategories: user?.quickIncomeCategories ?? [],
  });
}

export async function PATCH(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json();
  const data: Record<string, unknown> = {};

  // Handle hideAmounts (existing)
  if ("hideAmounts" in body) {
    data.hideAmounts = Boolean(body.hideAmounts);
  }

  // Handle quick category preferences
  if ("quickExpenseCategories" in body) {
    const ids = body.quickExpenseCategories;
    if (!Array.isArray(ids) || ids.length > 4 || !ids.every((id: unknown) => typeof id === "string")) {
      return NextResponse.json(
        { error: "quickExpenseCategories must be a string array with max 4 items" },
        { status: 400 }
      );
    }
    data.quickExpenseCategories = ids;
  }

  if ("quickIncomeCategories" in body) {
    const ids = body.quickIncomeCategories;
    if (!Array.isArray(ids) || ids.length > 4 || !ids.every((id: unknown) => typeof id === "string")) {
      return NextResponse.json(
        { error: "quickIncomeCategories must be a string array with max 4 items" },
        { status: 400 }
      );
    }
    data.quickIncomeCategories = ids;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      hideAmounts: true,
      quickExpenseCategories: true,
      quickIncomeCategories: true,
    },
  });

  return NextResponse.json({
    hideAmounts: user.hideAmounts,
    quickExpenseCategories: user.quickExpenseCategories,
    quickIncomeCategories: user.quickIncomeCategories,
  });
}
