import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { localCalendarDay } from "@/lib/period-progress";
import { buildCashFlowForecast, scheduledForecastEvents, type ForecastEvent } from "@/lib/cash-flow-forecast";
import { cashFlowForecastQuerySchema, forecastOpeningBalanceSchema } from "@/lib/validations";

const dateAtStart = (value: string, tz: number) => new Date(Date.parse(`${value}T00:00:00.000Z`) + tz * 60_000);
const dateAtEnd = (value: string, tz: number) => new Date(Date.parse(`${value}T23:59:59.999Z`) + tz * 60_000);
const addDays = (value: string, count: number) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};

const getForecast = async (request: Request, userId: string) => {
  const url = new URL(request.url);
  const parsed = cashFlowForecastQuerySchema.safeParse({ days: url.searchParams.get("days"), tz: url.searchParams.get("tz") });
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid horizon and timezone" }, { status: 400 });
  const { days, tz } = parsed.data;
  const today = localCalendarDay(new Date(), tz);
  const to = addDays(today, days - 1);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { forecastOpeningBalance: true, forecastOpeningBalanceDate: true } });
  if (!user || user.forecastOpeningBalance === null || !user.forecastOpeningBalanceDate) {
    return NextResponse.json({ configured: false, today, horizonDays: days, assumptions: ["Add a dated opening tracked balance before using a forecast. This app does not yet reconcile bank accounts."] });
  }
  const openingDate = user.forecastOpeningBalanceDate.toISOString().slice(0, 10);
  if (openingDate > today) return NextResponse.json({ configured: false, today, horizonDays: days, assumptions: ["The opening tracked balance date cannot be in the future."] });
  const [past, future, schedules, plans] = await Promise.all([
    prisma.transaction.findMany({ where: { userId, date: { gte: dateAtStart(openingDate, tz), lte: dateAtEnd(today, tz) } }, select: { amount: true, type: true } }),
    prisma.transaction.findMany({ where: { userId, date: { gte: dateAtStart(addDays(today, 1), tz), lte: dateAtEnd(to, tz) } }, select: { date: true, amount: true, type: true, description: true } }),
    prisma.scheduledTransaction.findMany({ where: { userId, isActive: true, nextDueDate: { lte: new Date(`${to}T00:00:00.000Z`) } }, select: { id: true, amount: true, description: true, type: true, frequency: true, customIntervalDays: true, startDate: true, endDate: true, nextDueDate: true, isVariable: true, transactions: { select: { id: true, date: true, amount: true } }, occurrences: { where: { status: { in: ["PAID", "SKIPPED"] } }, select: { dueDate: true, transactionId: true } } } }),
    prisma.budgetPlan.findMany({ where: { userId, month: { gte: today.slice(0, 7), lte: to.slice(0, 7) } }, orderBy: [{ month: "asc" }, { revision: "desc" }], include: { allocations: { select: { amount: true, kind: true, category: { select: { type: true } } } } } }),
  ]);
  const current = past.reduce((balance, row) => balance + (row.type === "INCOME" ? row.amount : -row.amount), user.forecastOpeningBalance);
  const events: ForecastEvent[] = future.map((row) => ({ date: localCalendarDay(row.date, tz), amount: row.type === "INCOME" ? row.amount : -row.amount, kind: "future-transaction", description: row.description || "Future-dated transaction", estimated: false, assumption: "A transaction already entered for this date." }));
  // PAID occurrence logs identify the scheduled date a linked transaction settled. A payment's
  // transaction date can differ from its due date, so comparing transaction dates is incorrect.
  events.push(...scheduledForecastEvents(schedules.map((schedule) => ({ ...schedule, payments: schedule.transactions })), today, to, tz));
  const latestPlan = new Map<string, typeof plans[number]>();
  plans.forEach((plan) => { if (!latestPlan.has(plan.month)) latestPlan.set(plan.month, plan); });
  for (const [month, plan] of latestPlan) {
    const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    const allocationDays = plan.allocations.filter((row) => row.category.type === "EXPENSE" && (row.kind === "FLEXIBLE" || row.kind === "SAVINGS"));
    for (let n = 1; n <= monthEnd; n += 1) {
      const date = `${month}-${String(n).padStart(2, "0")}`;
      if (date < today || date > to) continue;
      allocationDays.forEach((allocation) => events.push({ date, amount: Number(allocation.amount) / monthEnd, kind: allocation.kind === "SAVINGS" ? "savings-contribution" : "flexible-pace", description: allocation.kind === "SAVINGS" ? "Planned savings contribution" : "Flexible budget pace", estimated: true, assumption: `${allocation.kind === "SAVINGS" ? "Savings" : "Flexible"} allocation spread evenly across ${monthEnd} days.` }));
    }
  }
  const result = buildCashFlowForecast({ openingBalance: current, from: today, to, events });
  return NextResponse.json({ configured: true, today, horizonDays: days, openingBalance: user.forecastOpeningBalance, openingBalanceDate: openingDate, trackedBalanceToday: current, daily: result.days, lowestBalance: result.lowestBalance, cashCrunches: result.cashCrunches, assumptions: ["Projected tracked balance is not a reconciled bank balance.", "Future-dated transactions are treated as committed.", "Fixed bills and income use their schedules; variable bills are estimates based on their own payment history.", "Flexible and Savings allocations are spread evenly through each month. Unplanned spending, transfers, and account balances are not modeled."] });
};

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;
  try {
    return await getForecast(request, userId);
  } catch {
    return NextResponse.json({ error: "Failed to load cash-flow forecast" }, { status: 500 });
  }
}

const saveForecastOpeningBalance = async (request: Request, userId: string) => {
  const parsed = forecastOpeningBalanceSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid opening balance and date" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezoneOffset: true } });
  if (!user) return NextResponse.json({ error: "Failed to save cash-flow forecast" }, { status: 500 });
  if (parsed.data.openingBalanceDate > localCalendarDay(new Date(), user.timezoneOffset)) {
    return NextResponse.json({ error: "Opening balance date cannot be in the future" }, { status: 400 });
  }
  await prisma.user.update({ where: { id: userId }, data: { forecastOpeningBalance: parsed.data.openingBalance, forecastOpeningBalanceDate: new Date(`${parsed.data.openingBalanceDate}T00:00:00.000Z`) } });
  return NextResponse.json({ ok: true });
};

export async function PUT(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;
  try {
    return await saveForecastOpeningBalance(request, userId);
  } catch {
    return NextResponse.json({ error: "Failed to save cash-flow forecast" }, { status: 500 });
  }
}
