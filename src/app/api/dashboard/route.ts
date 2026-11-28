import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { getOwedOnCards } from "@/lib/credit-account-queries";
import { userCanUseCreditCards } from "@/lib/credit-card-access";
import { buildCategoryBreakdown, buildMonthlyTrend } from "@/lib/dashboard-aggregates";
import { buildBalanceMonths, legacyBalanceTrend } from "@/lib/balance-trend";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month"); // format: YYYY-MM
  const tz = parseInt(searchParams.get("tz") || "0"); // getTimezoneOffset() value
  const tzMs = tz * 60 * 1000;

  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  if (month) {
    const [year, m] = month.split("-").map(Number);
    startDate = new Date(Date.UTC(year, m - 1, 1) + tzMs);
    endDate = new Date(Date.UTC(year, m, 0, 23, 59, 59, 999) + tzMs);
  } else {
    // Determine "current month" in the user's timezone
    const localNow = new Date(now.getTime() - tzMs);
    startDate = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), 1) + tzMs);
    endDate = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() + 1, 0, 23, 59, 59, 999) + tzMs);
  }

  // Balance trend window: the 1st of the month before the selected one, so the chart can overlay
  // the two months by day of month
  const selectedLocal = new Date(startDate.getTime() - tzMs);
  const trendStart = new Date(
    Date.UTC(selectedLocal.getUTCFullYear(), selectedLocal.getUTCMonth() - 1, 1) + tzMs
  );

  // Helper: convert UTC timestamp to user's local month key
  const toLocalMonthKey = (date: Date) => {
    const local = new Date(date.getTime() - tzMs);
    return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  // Fetch all data in parallel
  const [
    transactions,
    recentTransactions,
    monthlyData,
    runningIncome,
    runningExpenses,
    trendWindowTx,
    owedOnCards,
  ] = await Promise.all([
    // Current month transactions for stats
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      include: { category: true },
    }),

    // Recent 5 transactions (any month) — ordered by date then creation time
    prisma.transaction.findMany({
      where: { userId },
      include: {
        category: true,
        bill: true,
        labels: { include: { label: true } },
        creditAccount: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: 5,
    }),

    // Six months ending at the selected month, for the trend chart (timezone-adjusted boundaries)
    prisma.transaction.findMany({
      where: {
        userId,
        date: {
          gte: new Date(Date.UTC(selectedLocal.getUTCFullYear(), selectedLocal.getUTCMonth() - 5, 1) + tzMs),
          lte: endDate,
        },
      },
      select: { amount: true, type: true, date: true },
    }),

    // All-time income up to end of selected month (for running balance)
    prisma.transaction.aggregate({
      where: { userId, type: "INCOME", date: { lte: endDate } },
      _sum: { amount: true },
    }),

    // All-time expenses up to end of selected month (for running balance)
    prisma.transaction.aggregate({
      where: { userId, type: "EXPENSE", date: { lte: endDate } },
      _sum: { amount: true },
    }),

    // Transactions from the 1st of the previous month (for the balance trend chart)
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: trendStart, lte: endDate },
      },
      select: { amount: true, type: true, date: true },
      orderBy: { date: "asc" },
    }),

    // Up to the end of the selected month, like the running balance beside it (see `owedOnCards` in
    // DashboardStats for how the two relate). Null for a user the /admin/settings switch keeps from cards.
    userCanUseCreditCards(prisma, userId).then((allowed) =>
      allowed ? getOwedOnCards(prisma, userId, endDate) : null
    ),
  ]);

  // Calculate monthly totals (selected month only)
  const totalIncome = transactions
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = transactions
    .filter((t) => t.type === "EXPENSE")
    .reduce((sum, t) => sum + t.amount, 0);

  // Running balance = all income ever − all expenses ever, up to end of selected month
  const runningBalance =
    (runningIncome._sum.amount ?? 0) - (runningExpenses._sum.amount ?? 0);

  const categoryBreakdown = buildCategoryBreakdown(transactions, totalExpenses);
  const monthlyTrend = buildMonthlyTrend(monthlyData, selectedLocal, toLocalMonthKey);

  const balanceMonths = buildBalanceMonths({
    month: toLocalMonthKey(startDate),
    closingBalance: runningBalance,
    rows: trendWindowTx,
    timezoneOffset: tz,
  });

  return NextResponse.json({
    owedOnCards,
    totalIncome,
    totalExpenses,
    balance: totalIncome - totalExpenses, // monthly net (income - expenses for selected month)
    runningBalance,                        // cumulative: all-time net up to end of selected month
    transactionCount: transactions.length,
    recentTransactions,
    categoryBreakdown,
    monthlyTrend,
    balanceTrend: legacyBalanceTrend(balanceMonths), // deprecated: read by tabs open on the previous build
    balanceMonths,
  });
}
