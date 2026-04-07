import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { analyticsQuerySchema } from "@/lib/validations";
import type {
  AnalyticsCategoryItem,
  AnalyticsLabelItem,
  AnalyticsCashFlowItem,
  AnalyticsGranularity,
  AnalyticsSummary,
  AnalyticsStatistics,
  AnalyticsTopRecord,
  AnalyticsHealthScore,
  HealthSubScore,
  HealthTrend,
} from "@/types";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Convert a UTC date to a bucket key based on granularity (in user's local timezone). */
const toBucketKey = (date: Date, granularity: AnalyticsGranularity, tzMs: number): string => {
  const local = new Date(date.getTime() - tzMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  if (granularity === "yearly") return `${y}`;
  if (granularity === "monthly") return `${y}-${String(m + 1).padStart(2, "0")}`;

  // Weekly: find Monday of the week
  const dayOfWeek = local.getUTCDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(Date.UTC(y, m, d + mondayOffset));
  const mY = monday.getUTCFullYear();
  const mM = monday.getUTCMonth();
  const mD = monday.getUTCDate();
  return `${mY}-${String(mM + 1).padStart(2, "0")}-${String(mD).padStart(2, "0")}`;
};

/** Generate a human-readable label for a bucket key. Clamps weekly labels to rangeFrom/rangeTo. */
const toBucketLabel = (key: string, granularity: AnalyticsGranularity, rangeFrom?: Date, rangeTo?: Date): string => {
  if (granularity === "yearly") return key;

  if (granularity === "monthly") {
    const [y, m] = key.split("-").map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }

  // Weekly: show clamped date range
  const [y, m, d] = key.split("-").map(Number);
  let start = new Date(Date.UTC(y, m - 1, d));
  let end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

  if (rangeFrom && start < rangeFrom) start = rangeFrom;
  if (rangeTo && end > rangeTo) end = rangeTo;

  const sLabel = `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const eLabel = start.getUTCMonth() === end.getUTCMonth()
    ? `${end.getUTCDate()}`
    : `${MONTH_NAMES[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `${sLabel}–${eLabel}`;
};

/** Generate all expected bucket keys between from and to dates. */
const generateBucketKeys = (from: Date, to: Date, granularity: AnalyticsGranularity, tzMs: number): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(from.getTime());

  const stepMs = granularity === "weekly" ? 24 * 60 * 60 * 1000 : 0;

  while (cursor <= to) {
    const key = toBucketKey(cursor, granularity, tzMs);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }

    if (granularity === "yearly") {
      cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
      cursor.setUTCMonth(0, 1);
    } else if (granularity === "monthly") {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    } else {
      cursor.setTime(cursor.getTime() + stepMs);
    }
  }

  return keys;
};

/** Generate a human-readable label for a period's from/to range. */
const formatPeriodLabel = (from: string, to: string): string => {
  const [fY, fM, fD] = from.split("-").map(Number);
  const [tY, tM, tD] = to.split("-").map(Number);

  // Single full month: "April 2026"
  const lastDayOfMonth = new Date(fY, fM, 0).getDate();
  if (fD === 1 && fY === tY && fM === tM && tD === lastDayOfMonth) {
    return `${MONTH_FULL[fM - 1]} ${fY}`;
  }
  // Full year: "2026"
  if (fM === 1 && fD === 1 && tM === 12 && tD === 31 && fY === tY) {
    return `${fY}`;
  }
  // Same year
  if (fY === tY) {
    return `${MONTH_NAMES[fM - 1]} ${fD} – ${MONTH_NAMES[tM - 1]} ${tD}, ${tY}`;
  }
  return `${MONTH_NAMES[fM - 1]} ${fD}, ${fY} – ${MONTH_NAMES[tM - 1]} ${tD}, ${tY}`;
};

/** Compute summary + category breakdown from a transaction set. */
const computePeriodData = (
  transactions: Array<{ amount: number; type: string; categoryId: string; category: { name: string; color: string; icon: string }; labels?: Array<{ labelId: string; label: { name: string; color: string } }> }>,
  type: string,
) => {
  // Summary always uses all transactions (unfiltered) so totals stay consistent
  const totalIncome = transactions
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.type === "EXPENSE")
    .reduce((sum, t) => sum + t.amount, 0);

  const summary: AnalyticsSummary = {
    totalIncome,
    totalExpenses,
    netCashFlow: totalIncome - totalExpenses,
    transactionCount: transactions.length,
  };

  // Category breakdown (filtered by type)
  const filtered = type === "ALL" ? transactions : transactions.filter((t) => t.type === type);
  const categoryMap = new Map<string, AnalyticsCategoryItem>();
  const total = filtered.reduce((sum, t) => sum + t.amount, 0);

  for (const t of filtered) {
    // Composite key: same categoryId can appear as both INCOME and EXPENSE in ALL mode
    const mapKey = `${t.categoryId}:${t.type}`;
    const existing = categoryMap.get(mapKey);
    if (existing) {
      existing.amount += t.amount;
      existing.transactionCount += 1;
    } else {
      categoryMap.set(mapKey, {
        id: mapKey,
        name: t.category.name,
        color: t.category.color,
        icon: t.category.icon,
        type: t.type as "INCOME" | "EXPENSE",
        amount: t.amount,
        percentage: 0,
        transactionCount: 1,
      });
    }
  }

  const categoryBreakdown = Array.from(categoryMap.values())
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({
      ...item,
      percentage: total > 0 ? Math.round((item.amount / total) * 100) : 0,
    }));

  return { summary, categoryBreakdown };
};

/** Compute records & statistics from transactions. */
const computeStatistics = (
  transactions: Array<{ amount: number; type: string; description: string; date: Date; category: { name: string; color: string; icon: string } }>,
  allCategoryBreakdown: AnalyticsCategoryItem[],
  summary: AnalyticsSummary,
  startDate: Date,
  endDate: Date,
  tzMs: number,
): AnalyticsStatistics => {
  const toLocalDate = (d: Date) => {
    const local = new Date(d.getTime() - tzMs);
    return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
  };

  // Include year in labels when range spans multiple calendar years
  const startLocal = new Date(startDate.getTime() - tzMs);
  const endLocal = new Date(endDate.getTime() - tzMs);
  const multiYear = startLocal.getUTCFullYear() !== endLocal.getUTCFullYear();

  const toDateLabel = (d: Date) => {
    const local = new Date(d.getTime() - tzMs);
    const label = `${MONTH_NAMES[local.getUTCMonth()]} ${local.getUTCDate()}`;
    return multiYear ? `${label}, ${local.getUTCFullYear()}` : label;
  };

  // Single pass: build day map + track top records + count by type
  let biggestExpense: (typeof transactions)[0] | null = null;
  let biggestIncome: (typeof transactions)[0] | null = null;
  let expenseCount = 0;
  let incomeCount = 0;
  const dayMap = new Map<string, { expenses: number; count: number; hasExpense: boolean }>();

  for (const t of transactions) {
    const dayKey = toLocalDate(t.date);
    const day = dayMap.get(dayKey) ?? { expenses: 0, count: 0, hasExpense: false };
    day.count += 1;
    if (t.type === "EXPENSE") {
      expenseCount++;
      day.expenses += t.amount;
      day.hasExpense = true;
      if (!biggestExpense || t.amount >= biggestExpense.amount) biggestExpense = t;
    } else {
      incomeCount++;
      if (!biggestIncome || t.amount >= biggestIncome.amount) biggestIncome = t;
    }
    dayMap.set(dayKey, day);
  }

  // Top record formatters
  const toRecord = (t: (typeof transactions)[0]): AnalyticsTopRecord => ({
    amount: t.amount,
    description: t.description || t.category.name,
    date: toDateLabel(t.date),
    category: t.category.name,
    categoryIcon: t.category.icon,
    categoryColor: t.category.color,
  });

  // Most expensive day
  let mostExpensiveDay: AnalyticsStatistics["mostExpensiveDay"] = null;
  for (const [key, day] of dayMap) {
    if (day.hasExpense && (!mostExpensiveDay || day.expenses >= mostExpensiveDay.total)) {
      const [y, m, d] = key.split("-").map(Number);
      const dayLabel = `${MONTH_NAMES[m - 1]} ${d}`;
      mostExpensiveDay = { date: multiYear ? `${dayLabel}, ${y}` : dayLabel, total: day.expenses, count: day.count };
    }
  }

  // Days in period
  const totalDaysInPeriod = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  // Spending streak: longest consecutive days with expenses
  const expenseDays = new Set<string>();
  for (const [key, day] of dayMap) {
    if (day.hasExpense) expenseDays.add(key);
  }
  let spendingStreak = 0;
  let currentStreak = 0;
  const cursor = new Date(startDate.getTime());
  while (cursor <= endDate) {
    if (expenseDays.has(toLocalDate(cursor))) {
      currentStreak++;
      if (currentStreak > spendingStreak) spendingStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
    cursor.setTime(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  // Category insights from allCategoryBreakdown (already sorted by amount desc)
  const expenseCategories = allCategoryBreakdown.filter((c) => c.type === "EXPENSE");
  const mostExpensiveCategory = expenseCategories[0]
    ? { name: expenseCategories[0].name, icon: expenseCategories[0].icon, color: expenseCategories[0].color, amount: expenseCategories[0].amount }
    : null;

  let mostUsedCategory: AnalyticsStatistics["mostUsedCategory"] = null;
  for (const cat of allCategoryBreakdown) {
    if (!mostUsedCategory || cat.transactionCount >= mostUsedCategory.count) {
      mostUsedCategory = { name: cat.name, icon: cat.icon, color: cat.color, count: cat.transactionCount };
    }
  }

  return {
    biggestExpense: biggestExpense ? toRecord(biggestExpense) : null,
    biggestIncome: biggestIncome ? toRecord(biggestIncome) : null,
    mostExpensiveDay,
    avgDailySpend: totalDaysInPeriod > 0 ? summary.totalExpenses / totalDaysInPeriod : null,
    avgExpenseSize: expenseCount > 0 ? summary.totalExpenses / expenseCount : null,
    avgIncomeSize: incomeCount > 0 ? summary.totalIncome / incomeCount : null,
    totalTransactions: summary.transactionCount,
    activeDays: dayMap.size,
    totalDaysInPeriod,
    spendingStreak,
    mostUsedCategory,
    mostExpensiveCategory,
    categoriesUsed: allCategoryBreakdown.length,
  };
};

/** Map a score (0-100) to a label and determine trend from sub-score trends. */
const scoreLabel = (score: number): string => {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  if (score >= 20) return "Needs Attention";
  return "Critical";
};

/** Clamp a value to [min, max]. */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Compute financial health score from existing analytics data. */
const computeHealthScore = (
  summary: AnalyticsSummary,
  previousSummary: AnalyticsSummary,
  allCategoryBreakdown: AnalyticsCategoryItem[],
  statistics: AnalyticsStatistics,
  hasPreviousData: boolean,
): AnalyticsHealthScore => {
  const { totalIncome, totalExpenses } = summary;

  // --- A. Savings Rate (weight 0.35) ---
  let savingsRateValue: number | null = null;
  let savingsScore: number;
  if (totalIncome === 0 && totalExpenses === 0) {
    savingsScore = 50;
  } else if (totalIncome === 0) {
    savingsRateValue = -1;
    savingsScore = 0;
  } else {
    savingsRateValue = (totalIncome - totalExpenses) / totalIncome;
    const r = savingsRateValue;
    if (r >= 0.50) savingsScore = 100;
    else if (r >= 0.20) savingsScore = 60 + ((r - 0.20) / 0.30) * 40;
    else if (r >= 0) savingsScore = 20 + (r / 0.20) * 40;
    else if (r >= -0.50) savingsScore = 20 + (r / 0.50) * 20;
    else savingsScore = 0;
  }
  savingsScore = clamp(Math.round(savingsScore), 0, 100);

  // Savings rate trend
  let savingsTrend: HealthTrend = "new";
  if (hasPreviousData) {
    const prevRate = previousSummary.totalIncome > 0
      ? (previousSummary.totalIncome - previousSummary.totalExpenses) / previousSummary.totalIncome
      : previousSummary.totalExpenses === 0 ? 0.5 : -1;
    const currentRate = savingsRateValue ?? 0.5;
    if (currentRate > prevRate + 0.02) savingsTrend = "improving";
    else if (currentRate < prevRate - 0.02) savingsTrend = "declining";
    else savingsTrend = "stable";
  }

  const savingsDesc = savingsRateValue !== null
    ? savingsRateValue >= 0
      ? `Saving ${Math.round(savingsRateValue * 100)}% of income`
      : `Spending ${Math.round(Math.abs(savingsRateValue) * 100)}% more than income`
    : "No income or expenses";

  // --- B. Expense Trend (weight 0.25) ---
  let expenseTrendScore = 50;
  let expenseTrendValue: number | null = null;
  let expenseTrend: HealthTrend = "new";
  if (hasPreviousData) {
    const prev = previousSummary.totalExpenses;
    const curr = totalExpenses;
    if (prev === 0 && curr === 0) {
      expenseTrendScore = 50;
      expenseTrend = "stable";
    } else if (prev === 0) {
      expenseTrendScore = 30;
      expenseTrendValue = 1;
      expenseTrend = "declining";
    } else {
      const change = (curr - prev) / prev;
      expenseTrendValue = change;
      if (change <= -0.30) expenseTrendScore = 100;
      else if (change <= 0) expenseTrendScore = 70 + (-change / 0.30) * 30;
      else if (change <= 0.30) expenseTrendScore = 40 + ((0.30 - change) / 0.30) * 30;
      else if (change <= 1.0) expenseTrendScore = ((1.0 - change) / 0.70) * 40;
      else expenseTrendScore = 0;

      if (change < -0.02) expenseTrend = "improving";
      else if (change > 0.02) expenseTrend = "declining";
      else expenseTrend = "stable";
    }
  }
  expenseTrendScore = clamp(Math.round(expenseTrendScore), 0, 100);

  const expenseDesc = !hasPreviousData
    ? "No previous period to compare"
    : expenseTrendValue !== null
      ? expenseTrendValue <= 0
        ? `Expenses down ${Math.round(Math.abs(expenseTrendValue) * 100)}% vs last period`
        : `Expenses up ${Math.round(expenseTrendValue * 100)}% vs last period`
      : "No change in expenses";

  // --- C. Income Stability (weight 0.15) ---
  let incomeScore = 50;
  let incomeValue: number | null = null;
  let incomeTrend: HealthTrend = "new";
  if (hasPreviousData) {
    const prev = previousSummary.totalIncome;
    const curr = totalIncome;
    if (prev === 0 && curr === 0) {
      incomeScore = 50;
      incomeTrend = "stable";
    } else if (prev === 0) {
      incomeScore = 80;
      incomeValue = 1;
      incomeTrend = "improving";
    } else {
      const change = (curr - prev) / prev;
      incomeValue = change;
      if (change >= 0.20) incomeScore = 100;
      else if (change >= 0) incomeScore = 70 + (change / 0.20) * 30;
      else if (change >= -0.30) incomeScore = 30 + ((0.30 + change) / 0.30) * 40;
      else if (change >= -1.0) incomeScore = ((1.0 + change) / 0.70) * 30;
      else incomeScore = 0;

      if (change > 0.02) incomeTrend = "improving";
      else if (change < -0.02) incomeTrend = "declining";
      else incomeTrend = "stable";
    }
  }
  incomeScore = clamp(Math.round(incomeScore), 0, 100);

  const incomeDesc = !hasPreviousData
    ? "No previous period to compare"
    : incomeValue !== null
      ? incomeValue >= 0
        ? `Income up ${Math.round(incomeValue * 100)}% vs last period`
        : `Income down ${Math.round(Math.abs(incomeValue) * 100)}% vs last period`
      : "No change in income";

  // --- D. Category Diversification (weight 0.15) ---
  const expenseCategories = allCategoryBreakdown.filter((c) => c.type === "EXPENSE");
  let diversificationScore: number;
  if (expenseCategories.length === 0) {
    diversificationScore = 50;
  } else if (expenseCategories.length === 1) {
    diversificationScore = 20;
  } else {
    const total = expenseCategories.reduce((s, c) => s + c.amount, 0);
    let entropy = 0;
    for (const cat of expenseCategories) {
      const p = cat.amount / total;
      if (p > 0) entropy -= p * Math.log(p);
    }
    const maxEntropy = Math.log(expenseCategories.length);
    diversificationScore = Math.round((entropy / maxEntropy) * 100);
  }
  diversificationScore = clamp(diversificationScore, 0, 100);

  // Diversification trend
  let divTrend: HealthTrend = "stable";
  const divDesc = expenseCategories.length === 0
    ? "No expenses to categorize"
    : `Spending across ${expenseCategories.length} categories`;

  // --- E. Spending Consistency (weight 0.10) ---
  let consistencyScore: number;
  const { activeDays, totalDaysInPeriod, totalTransactions } = statistics;
  if (totalTransactions === 0) {
    consistencyScore = 0;
  } else if (totalDaysInPeriod === 0) {
    consistencyScore = 50;
  } else {
    const ratio = activeDays / totalDaysInPeriod;
    if (ratio >= 0.80) consistencyScore = 100;
    else if (ratio >= 0.40) consistencyScore = 50 + ((ratio - 0.40) / 0.40) * 50;
    else if (ratio >= 0.10) consistencyScore = ((ratio - 0.10) / 0.30) * 50;
    else consistencyScore = 0;
  }
  consistencyScore = clamp(Math.round(consistencyScore), 0, 100);

  const consistencyDesc = totalDaysInPeriod > 0
    ? `Active ${activeDays} of ${totalDaysInPeriod} days (${Math.round((activeDays / totalDaysInPeriod) * 100)}%)`
    : "No data for this period";

  // --- Composite score ---
  const overallScore = clamp(Math.round(
    savingsScore * 0.35 +
    expenseTrendScore * 0.25 +
    incomeScore * 0.15 +
    diversificationScore * 0.15 +
    consistencyScore * 0.10
  ), 0, 100);

  // Overall trend: majority of sub-score trends
  const trends = [savingsTrend, expenseTrend, incomeTrend, divTrend];
  const improving = trends.filter((t) => t === "improving").length;
  const declining = trends.filter((t) => t === "declining").length;
  const overallTrend: HealthTrend = !hasPreviousData ? "new" : improving > declining ? "improving" : declining > improving ? "declining" : "stable";

  const mkSub = (score: number, label: string, description: string, trend: HealthTrend, rawValue: number | null): HealthSubScore =>
    ({ score, label, description, trend, rawValue });

  return {
    overallScore,
    overallLabel: scoreLabel(overallScore),
    overallTrend,
    savingsRate: savingsRateValue,
    subScores: {
      savingsRate: mkSub(savingsScore, "Savings Rate", savingsDesc, savingsTrend, savingsRateValue),
      expenseTrend: mkSub(expenseTrendScore, "Expense Trend", expenseDesc, expenseTrend, expenseTrendValue),
      incomeStability: mkSub(incomeScore, "Income Stability", incomeDesc, incomeTrend, incomeValue),
      diversification: mkSub(diversificationScore, "Diversification", divDesc, divTrend, null),
      consistency: mkSub(consistencyScore, "Consistency", consistencyDesc, "stable", null),
    },
  };
};

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const parsed = analyticsQuerySchema.safeParse({
    granularity: searchParams.get("granularity"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    tz: searchParams.get("tz"),
    type: searchParams.get("type") || "ALL",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { granularity, from, to, tz, type } = parsed.data;
  const tzMs = tz * 60 * 1000;

  // Compute timezone-adjusted date boundaries
  const fromDate = new Date(from + "T00:00:00.000Z");
  const toDate = new Date(to + "T23:59:59.999Z");
  const startDate = new Date(fromDate.getTime() + tzMs);
  const endDate = new Date(toDate.getTime() + tzMs);

  // Compute previous period (calendar-aware shift)
  const [fY, fM, fD] = from.split("-").map(Number);
  const [tY, tM, tD] = to.split("-").map(Number);

  let prevFrom: string;
  let prevTo: string;

  const lastDayOfFromMonth = new Date(fY, fM, 0).getDate();
  if (fD === 1 && fY === tY && fM === tM && tD === lastDayOfFromMonth) {
    // Monthly (full month only): shift back one calendar month
    const pm = fM - 1 === 0 ? 12 : fM - 1;
    const py = fM - 1 === 0 ? fY - 1 : fY;
    const lastDay = new Date(py, pm, 0).getDate();
    prevFrom = `${py}-${String(pm).padStart(2, "0")}-01`;
    prevTo = `${py}-${String(pm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  } else if (fM === 1 && fD === 1 && tM === 12 && tD === 31 && fY === tY) {
    // Yearly: shift back one calendar year
    prevFrom = `${fY - 1}-01-01`;
    prevTo = `${fY - 1}-12-31`;
  } else {
    // Weekly or custom: shift by exact day span
    const fromD = new Date(fY, fM - 1, fD);
    const toD = new Date(tY, tM - 1, tD);
    const spanDays = Math.round((toD.getTime() - fromD.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const pFrom = new Date(fY, fM - 1, fD - spanDays);
    const pTo = new Date(tY, tM - 1, tD - spanDays);
    const fmtD = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    prevFrom = fmtD(pFrom);
    prevTo = fmtD(pTo);
  }

  const prevFromDate = new Date(prevFrom + "T00:00:00.000Z");
  const prevToDate = new Date(prevTo + "T23:59:59.999Z");
  const prevStartDate = new Date(prevFromDate.getTime() + tzMs);
  const prevEndDate = new Date(prevToDate.getTime() + tzMs);

  // Fetch current + previous period transactions in parallel
  const [transactions, prevTransactions] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      include: { category: true, labels: { include: { label: true } } },
    }),
    prisma.transaction.findMany({
      where: { userId, date: { gte: prevStartDate, lte: prevEndDate } },
      include: { category: true, labels: { include: { label: true } } },
    }),
  ]);

  // --- Current period: time series ---
  const bucketKeys = generateBucketKeys(startDate, endDate, granularity, tzMs);

  const periodMap = new Map<string, { income: number; expenses: number }>();
  for (const key of bucketKeys) {
    periodMap.set(key, { income: 0, expenses: 0 });
  }

  for (const t of transactions) {
    const key = toBucketKey(new Date(t.date), granularity, tzMs);
    const bucket = periodMap.get(key);
    if (bucket) {
      if (t.type === "INCOME") bucket.income += t.amount;
      else bucket.expenses += t.amount;
    }
  }

  const cashFlow: AnalyticsCashFlowItem[] = [];
  let cumulativeNet = 0;

  for (const key of bucketKeys) {
    const bucket = periodMap.get(key)!;
    const periodLabel = toBucketLabel(key, granularity, fromDate, toDate);
    const net = bucket.income - bucket.expenses;
    cumulativeNet += net;

    cashFlow.push({ period: key, periodLabel, income: bucket.income, expenses: bucket.expenses, net, cumulativeNet });
  }

  // --- Compute unfiltered (ALL) first, then derive filtered if needed ---
  const { summary, categoryBreakdown: allCategoryBreakdown } = computePeriodData(transactions, "ALL");
  const { summary: previousSummary, categoryBreakdown: allPreviousCategoryBreakdown } = computePeriodData(prevTransactions, "ALL");

  // Only need the filtered breakdown; summary comes from ALL above
  const categoryBreakdown = type === "ALL"
    ? allCategoryBreakdown
    : computePeriodData(transactions, type).categoryBreakdown;
  const previousCategoryBreakdown = type === "ALL"
    ? allPreviousCategoryBreakdown
    : computePeriodData(prevTransactions, type).categoryBreakdown;

  // --- Label Breakdown (current period only) ---
  const filteredForLabel = type === "ALL" ? transactions : transactions.filter((t) => t.type === type);
  const labelMap = new Map<string, AnalyticsLabelItem>();
  const totalForLabelPct = filteredForLabel.reduce((sum, t) => sum + t.amount, 0);
  let unlabeledAmount = 0;
  let unlabeledCount = 0;

  for (const t of filteredForLabel) {
    if (!t.labels || t.labels.length === 0) {
      unlabeledAmount += t.amount;
      unlabeledCount += 1;
      continue;
    }
    const share = t.amount / t.labels.length;
    for (const tl of t.labels) {
      const existing = labelMap.get(tl.labelId);
      if (existing) {
        existing.amount += share;
        existing.transactionCount += 1;
      } else {
        labelMap.set(tl.labelId, {
          id: tl.labelId,
          name: tl.label.name,
          color: tl.label.color,
          amount: share,
          percentage: 0,
          transactionCount: 1,
        });
      }
    }
  }

  const labelEntries: AnalyticsLabelItem[] = Array.from(labelMap.values()).map((item) => ({
    ...item,
    percentage: totalForLabelPct > 0 ? Math.round((item.amount / totalForLabelPct) * 100) : 0,
  }));

  if (unlabeledCount > 0) {
    labelEntries.push({
      id: "unlabeled",
      name: "Unlabeled",
      color: "#9CA3AF",
      amount: unlabeledAmount,
      percentage: totalForLabelPct > 0 ? Math.round((unlabeledAmount / totalForLabelPct) * 100) : 0,
      transactionCount: unlabeledCount,
    });
  }

  const labelBreakdown = [...labelEntries].sort((a, b) => b.amount - a.amount);

  // --- Statistics ---
  const statistics = computeStatistics(transactions, allCategoryBreakdown, summary, startDate, endDate, tzMs);

  // --- Health Score ---
  const hasPreviousData = previousSummary.transactionCount > 0;
  const healthScore = computeHealthScore(summary, previousSummary, allCategoryBreakdown, statistics, hasPreviousData);

  // --- Period labels ---
  const periodLabel = formatPeriodLabel(from, to);
  const previousPeriodLabel = formatPeriodLabel(prevFrom, prevTo);

  return NextResponse.json({
    categoryBreakdown,
    allCategoryBreakdown,
    labelBreakdown,
    cashFlow,
    summary,
    previousSummary,
    previousCategoryBreakdown,
    allPreviousCategoryBreakdown,
    periodLabel,
    previousPeriodLabel,
    statistics,
    healthScore,
  });
}
