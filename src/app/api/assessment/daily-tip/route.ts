import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { getBudgetOverview, getSpendingByCategory, getUpcomingBills } from "@/lib/budget-queries";
import { generateDailyTip, type DailyTipInput, type UpcomingBillsContext } from "@/lib/ai-assessment";
import type { AiDailyTip, AiDailyTipResponse } from "@/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** GET /api/assessment/daily-tip — today's tip (cached per local day; lazily generated). */
export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true, timezoneOffset: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Local "today" using the user's stored timezone offset (minutes).
  const localNow = new Date(Date.now() - user.timezoneOffset * 60_000);
  const localDate = localNow.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthStr = localDate.slice(0, 7); // YYYY-MM
  const monthLabel = `${MONTHS[localNow.getUTCMonth()]} ${localNow.getUTCFullYear()}`;
  const periodKey = `daily:${localDate}`;

  const cached = await prisma.aiAssessment.findUnique({
    where: { userId_kind_periodKey: { userId, kind: "DAILY_TIP", periodKey } },
  });
  if (cached) {
    const body: AiDailyTipResponse = {
      tip: cached.content as unknown as AiDailyTip,
      generatedAt: cached.generatedAt.toISOString(),
    };
    return NextResponse.json(body);
  }

  try {
    const [overview, spending, billsResult] = await Promise.all([
      getBudgetOverview(prisma, userId, { month: monthStr }),
      getSpendingByCategory(prisma, userId, { month: monthStr }),
      getUpcomingBills(prisma, userId, { days: 14 }),
    ]);

    const bills: UpcomingBillsContext = {
      count: billsResult.count,
      totalAmount: billsResult.totalAmount,
      bills: billsResult.bills,
    };
    const input: DailyTipInput = {
      currency: user.currency,
      monthLabel,
      income: overview.totalIncome,
      expenses: overview.totalExpenses,
      net: overview.net,
      topCategories: spending.slice(0, 6).map((c) => ({ name: c.name, amount: c.amount, pct: c.percentage })),
      upcomingBills: bills,
    };

    const { tip, model } = await generateDailyTip(input);

    const content = tip as unknown as Prisma.InputJsonValue;
    const row = await prisma.aiAssessment.upsert({
      where: { userId_kind_periodKey: { userId, kind: "DAILY_TIP", periodKey } },
      create: { userId, kind: "DAILY_TIP", periodKey, content, model },
      update: { content, model, generatedAt: new Date() },
    });
    // Best-effort metering — must not blank the already-saved tip (which would then be
    // cached empty for the rest of the local day) if this write fails.
    await prisma.aiUsageLog
      .create({ data: { userId, kind: "DAILY_TIP" } })
      .catch((e) => console.error("[assessment/daily-tip] usage log failed:", e instanceof Error ? e.message : e));

    const body: AiDailyTipResponse = { tip, generatedAt: row.generatedAt.toISOString() };
    return NextResponse.json(body);
  } catch (error) {
    // Non-blocking: the daily tip is a nicety — degrade to "no tip", but log so failures are visible.
    console.error("[assessment/daily-tip] failed:", error instanceof Error ? error.message : error);
    const body: AiDailyTipResponse = { tip: null, generatedAt: null };
    return NextResponse.json(body);
  }
}
