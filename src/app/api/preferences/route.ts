import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { mcpWriteLeaseSchema, quickPickIdsSchema } from "@/lib/validations";
import { MAX_QUICK_CATEGORIES } from "@/lib/quick-categories";
import { MAX_QUICK_LABELS } from "@/lib/quick-labels";

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
      mcpWritesEnabledUntil: true,
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
    mcpWritesEnabledUntil: user?.mcpWritesEnabledUntil?.toISOString() ?? null,
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

  // MCP write lease. Accepts minutes-from-now so the client never sends an absolute instant its
  // clock disagrees with, `null` to switch writes off, and a bounded ceiling so a mis-sent value
  // cannot leave writes open indefinitely.
  if ("mcpWriteMinutes" in body) {
    const lease = mcpWriteLeaseSchema.safeParse(body.mcpWriteMinutes);
    if (!lease.success) {
      return NextResponse.json({ error: "Invalid write lease" }, { status: 400 });
    }
    data.mcpWritesEnabledUntil =
      lease.data === null ? null : new Date(Date.now() + lease.data * 60_000);
  }

  // Handle quick-pick preferences. Each list is capped and must hold distinct ids: the pickers
  // count the stored list against their slot limit, so a repeated id silently consumes a slot the
  // user can never fill. See quickPickIdsSchema.
  const quickLists = [
    { field: "quickExpenseCategories", max: MAX_QUICK_CATEGORIES },
    { field: "quickIncomeCategories", max: MAX_QUICK_CATEGORIES },
    { field: "quickLabels", max: MAX_QUICK_LABELS },
  ] as const;

  for (const { field, max } of quickLists) {
    if (!(field in body)) continue;
    const parsed = quickPickIdsSchema(max).safeParse(body[field]);
    if (!parsed.success) {
      return NextResponse.json(
        { error: `${field} must be a string array of at most ${max} distinct ids` },
        { status: 400 }
      );
    }
    data[field] = parsed.data;
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
      mcpWritesEnabledUntil: true,
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
    mcpWritesEnabledUntil: user.mcpWritesEnabledUntil?.toISOString() ?? null,
  });
}
