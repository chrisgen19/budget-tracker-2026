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
      quickLabels: true,
      receiptScanEnabled: true,
      transactionLayout: true,
      transactionAmountAutofocus: true,
      defaultLabelType: true,
      showDayName: true,
      dayNameFormat: true,
      emailBillReminders: true,
    },
  });

  return NextResponse.json({
    hideAmounts: user?.hideAmounts ?? false,
    quickExpenseCategories: user?.quickExpenseCategories ?? [],
    quickIncomeCategories: user?.quickIncomeCategories ?? [],
    quickLabels: user?.quickLabels ?? [],
    receiptScanEnabled: user?.receiptScanEnabled ?? false,
    transactionLayout: user?.transactionLayout ?? "infinite",
    transactionAmountAutofocus: user?.transactionAmountAutofocus ?? true,
    defaultLabelType: user?.defaultLabelType ?? "EXPENSE",
    showDayName: user?.showDayName ?? true,
    dayNameFormat: user?.dayNameFormat ?? "SHORT",
    emailBillReminders: user?.emailBillReminders ?? false,
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

  // Handle receiptScanEnabled
  if ("receiptScanEnabled" in body) {
    data.receiptScanEnabled = Boolean(body.receiptScanEnabled);
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

  // Handle quick label preferences (single list, max 4)
  if ("quickLabels" in body) {
    const ids = body.quickLabels;
    if (!Array.isArray(ids) || ids.length > 4 || !ids.every((id: unknown) => typeof id === "string")) {
      return NextResponse.json(
        { error: "quickLabels must be a string array with max 4 items" },
        { status: 400 }
      );
    }
    data.quickLabels = ids;
  }

  if ("transactionLayout" in body) {
    const layout = body.transactionLayout;
    if (layout !== "infinite" && layout !== "pagination") {
      return NextResponse.json(
        { error: "transactionLayout must be 'infinite' or 'pagination'" },
        { status: 400 }
      );
    }
    data.transactionLayout = layout;
  }

  if ("transactionAmountAutofocus" in body) {
    data.transactionAmountAutofocus = Boolean(body.transactionAmountAutofocus);
  }

  if ("defaultLabelType" in body) {
    const val = body.defaultLabelType;
    if (val !== "EXPENSE" && val !== "INCOME" && val !== "BOTH") {
      return NextResponse.json(
        { error: "defaultLabelType must be 'EXPENSE', 'INCOME', or 'BOTH'" },
        { status: 400 }
      );
    }
    data.defaultLabelType = val;
  }

  if ("showDayName" in body) {
    data.showDayName = Boolean(body.showDayName);
  }

  if ("emailBillReminders" in body) {
    data.emailBillReminders = Boolean(body.emailBillReminders);
  }

  if ("dayNameFormat" in body) {
    const val = body.dayNameFormat;
    if (val !== "FULL" && val !== "SHORT") {
      return NextResponse.json(
        { error: "dayNameFormat must be 'FULL' or 'SHORT'" },
        { status: 400 }
      );
    }
    data.dayNameFormat = val;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      hideAmounts: true,
      quickExpenseCategories: true,
      quickIncomeCategories: true,
      quickLabels: true,
      receiptScanEnabled: true,
      transactionLayout: true,
      transactionAmountAutofocus: true,
      defaultLabelType: true,
      showDayName: true,
      dayNameFormat: true,
      emailBillReminders: true,
    },
  });

  return NextResponse.json({
    hideAmounts: user.hideAmounts,
    quickExpenseCategories: user.quickExpenseCategories,
    quickIncomeCategories: user.quickIncomeCategories,
    quickLabels: user.quickLabels,
    receiptScanEnabled: user.receiptScanEnabled,
    transactionLayout: user.transactionLayout,
    transactionAmountAutofocus: user.transactionAmountAutofocus,
    defaultLabelType: user.defaultLabelType,
    showDayName: user.showDayName,
    dayNameFormat: user.dayNameFormat,
    emailBillReminders: user.emailBillReminders,
  });
}
