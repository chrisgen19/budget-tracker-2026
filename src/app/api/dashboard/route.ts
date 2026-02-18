import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month"); // format: YYYY-MM

  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  if (month) {
    const [year, m] = month.split("-").map(Number);
    startDate = new Date(year, m - 1, 1);
    endDate = new Date(year, m, 0, 23, 59, 59, 999);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  // 30-day window for balance trend (ends at end of selected month)
  const trendStart = new Date(endDate);
  trendStart.setDate(trendStart.getDate() - 29);
  trendStart.setHours(0, 0, 0, 0);

  // Fetch all data in parallel
  const [
    transactions,
    recentTransactions,
    monthlyData,
    runningIncome,
    runningExpenses,
    trendWindowTx,
  ] = await Promise.all([
    // Current month transactions for stats
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      include: { category: true },
    }),

    // Recent 5 transactions (any month)
    prisma.transaction.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { date: "desc" },
      take: 5,
    }),

    // Last 6 months for trend chart
    prisma.transaction.findMany({
      where: {
        userId,
        date: {
          gte: new Date(now.getFullYear(), now.getMonth() - 5, 1),
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

    // Transactions within the 30-day trend window (for balance trend chart)
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: trendStart, lte: endDate },
      },
      select: { amount: true, type: true, date: true },
      orderBy: { date: "asc" },
    }),
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

  // Category breakdown (expenses only)
  const categoryMap = new Map<string, { name: string; color: string; icon: string; amount: number }>();

  for (const t of transactions.filter((t) => t.type === "EXPENSE")) {
    const existing = categoryMap.get(t.categoryId);
    if (existing) {
      existing.amount += t.amount;
    } else {
      categoryMap.set(t.categoryId, {
        name: t.category.name,
        color: t.category.color,
        icon: t.category.icon,
        amount: t.amount,
      });
    }
  }

  const categoryBreakdown = Array.from(categoryMap.values())
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({
      ...item,
      percentage: totalExpenses > 0 ? Math.round((item.amount / totalExpenses) * 100) : 0,
    }));

  // Monthly trend (last 6 months)
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthlyTrend = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthLabel = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;

    const monthTransactions = monthlyData.filter((t) => {
      const td = new Date(t.date);
      return `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, "0")}` === monthKey;
    });

    monthlyTrend.push({
      month: monthLabel,
      income: monthTransactions
        .filter((t) => t.type === "INCOME")
        .reduce((sum, t) => sum + t.amount, 0),
      expenses: monthTransactions
        .filter((t) => t.type === "EXPENSE")
        .reduce((sum, t) => sum + t.amount, 0),
    });
  }

  // Balance trend: daily running balance over the 30-day window
  // Derive prior balance from all-time totals minus window transactions
  const windowNet = trendWindowTx.reduce(
    (sum, t) => sum + (t.type === "INCOME" ? t.amount : -t.amount),
    0
  );
  const priorBalance = runningBalance - windowNet;

  // Group window transactions by day
  const txByDay = new Map<string, number>();
  for (const t of trendWindowTx) {
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const delta = t.type === "INCOME" ? t.amount : -t.amount;
    txByDay.set(key, (txByDay.get(key) ?? 0) + delta);
  }

  // Walk 30 days, accumulating from priorBalance
  const balanceTrend = [];
  let bal = priorBalance;
  for (let i = 0; i < 30; i++) {
    const d = new Date(trendStart);
    d.setDate(d.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    bal += txByDay.get(key) ?? 0;
    balanceTrend.push({ date: key, balance: bal });
  }

  return NextResponse.json({
    totalIncome,
    totalExpenses,
    balance: totalIncome - totalExpenses, // monthly net (income - expenses for selected month)
    runningBalance,                        // cumulative: all-time net up to end of selected month
    transactionCount: transactions.length,
    recentTransactions,
    categoryBreakdown,
    monthlyTrend,
    balanceTrend,
  });
}
