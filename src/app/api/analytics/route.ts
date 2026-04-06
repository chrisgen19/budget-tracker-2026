import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { analyticsQuerySchema } from "@/lib/validations";
import type {
  AnalyticsPeriodItem,
  AnalyticsCategoryItem,
  AnalyticsLabelItem,
  AnalyticsCashFlowItem,
  AnalyticsGranularity,
} from "@/types";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Convert a UTC date to a bucket key based on granularity (in user's local timezone). */
const toBucketKey = (date: Date, granularity: AnalyticsGranularity, tzMs: number): string => {
  const local = new Date(date.getTime() - tzMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();

  if (granularity === "yearly") return `${y}`;
  if (granularity === "monthly") return `${y}-${String(m + 1).padStart(2, "0")}`;

  // Weekly: ISO week — find Monday of the week
  const dayOfWeek = local.getUTCDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(Date.UTC(y, m, d + mondayOffset));
  const mY = monday.getUTCFullYear();
  const mM = monday.getUTCMonth();
  const mD = monday.getUTCDate();
  return `${mY}-${String(mM + 1).padStart(2, "0")}-${String(mD).padStart(2, "0")}`;
};

/** Generate a human-readable label for a bucket key. */
const toBucketLabel = (key: string, granularity: AnalyticsGranularity): string => {
  if (granularity === "yearly") return key;

  if (granularity === "monthly") {
    const [y, m] = key.split("-").map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
  }

  // Weekly: show "Mon D – Mon D" range
  const [y, m, d] = key.split("-").map(Number);
  const monday = new Date(Date.UTC(y, m - 1, d));
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  const mLabel = `${MONTH_NAMES[monday.getUTCMonth()]} ${monday.getUTCDate()}`;
  const sLabel = monday.getUTCMonth() === sunday.getUTCMonth()
    ? `${sunday.getUTCDate()}`
    : `${MONTH_NAMES[sunday.getUTCMonth()]} ${sunday.getUTCDate()}`;
  return `${mLabel}–${sLabel}`;
};

/** Generate all expected bucket keys between from and to dates. */
const generateBucketKeys = (from: Date, to: Date, granularity: AnalyticsGranularity, tzMs: number): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(from.getTime());

  // Step by day for weekly, by month for monthly, by year for yearly
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

  // Single query for all transactions in range with relations
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: endDate },
    },
    include: {
      category: true,
      labels: { include: { label: true } },
    },
    orderBy: { date: "asc" },
  });

  // Generate all bucket keys for the range (ensures empty periods appear)
  const bucketKeys = generateBucketKeys(startDate, endDate, granularity, tzMs);

  // --- Income & Expenses + Cash Flow ---
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

  const incomeExpenses: AnalyticsPeriodItem[] = [];
  const cashFlow: AnalyticsCashFlowItem[] = [];
  let cumulativeNet = 0;

  for (const key of bucketKeys) {
    const bucket = periodMap.get(key)!;
    const periodLabel = toBucketLabel(key, granularity);
    const net = bucket.income - bucket.expenses;
    cumulativeNet += net;

    incomeExpenses.push({
      period: key,
      periodLabel,
      income: bucket.income,
      expenses: bucket.expenses,
    });

    cashFlow.push({
      period: key,
      periodLabel,
      income: bucket.income,
      expenses: bucket.expenses,
      net,
      cumulativeNet,
    });
  }

  // --- Category Breakdown ---
  const filteredForCategory = type === "ALL"
    ? transactions
    : transactions.filter((t) => t.type === type);

  const categoryMap = new Map<string, AnalyticsCategoryItem>();
  const totalForCategoryPct = filteredForCategory.reduce((sum, t) => sum + t.amount, 0);

  for (const t of filteredForCategory) {
    const existing = categoryMap.get(t.categoryId);
    if (existing) {
      existing.amount += t.amount;
      existing.transactionCount += 1;
    } else {
      categoryMap.set(t.categoryId, {
        id: t.categoryId,
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
      percentage: totalForCategoryPct > 0
        ? Math.round((item.amount / totalForCategoryPct) * 100)
        : 0,
    }));

  // --- Label Breakdown ---
  const filteredForLabel = type === "ALL"
    ? transactions
    : transactions.filter((t) => t.type === type);

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
    for (const tl of t.labels) {
      const existing = labelMap.get(tl.labelId);
      if (existing) {
        existing.amount += t.amount;
        existing.transactionCount += 1;
      } else {
        labelMap.set(tl.labelId, {
          id: tl.labelId,
          name: tl.label.name,
          color: tl.label.color,
          amount: t.amount,
          percentage: 0,
          transactionCount: 1,
        });
      }
    }
  }

  const labelBreakdown: AnalyticsLabelItem[] = Array.from(labelMap.values())
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({
      ...item,
      percentage: totalForLabelPct > 0
        ? Math.round((item.amount / totalForLabelPct) * 100)
        : 0,
    }));

  // Add unlabeled bucket at the end
  if (unlabeledCount > 0) {
    labelBreakdown.push({
      id: "unlabeled",
      name: "Unlabeled",
      color: "#9CA3AF",
      amount: unlabeledAmount,
      percentage: totalForLabelPct > 0
        ? Math.round((unlabeledAmount / totalForLabelPct) * 100)
        : 0,
      transactionCount: unlabeledCount,
    });
  }

  // --- Summary ---
  const totalIncome = transactions
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = transactions
    .filter((t) => t.type === "EXPENSE")
    .reduce((sum, t) => sum + t.amount, 0);

  return NextResponse.json({
    incomeExpenses,
    categoryBreakdown,
    labelBreakdown,
    cashFlow,
    summary: {
      totalIncome,
      totalExpenses,
      netCashFlow: totalIncome - totalExpenses,
      transactionCount: transactions.length,
    },
  });
}
