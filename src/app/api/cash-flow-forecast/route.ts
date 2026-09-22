import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { localCalendarDay } from "@/lib/period-progress";
import { getBudgetPerformance } from "@/lib/budget-plans";
import { buildCashFlowForecast, cardPaymentEvents, previousDueDate, scheduleStatus, remainingBudgetPaceEvents, scheduledForecastEvents, type ForecastCard, type ForecastEvent } from "@/lib/cash-flow-forecast";
import { userCanUseCreditCards } from "@/lib/credit-card-access";
import {
  computeAccountBalance,
  foldLedgerGroups,
  observedPaymentWindow,
  openingBalanceAsOf,
  summariseObservedPayments,
} from "@/lib/credit-account-queries";
import { cashFlowForecastQuerySchema, forecastOpeningBalanceSchema } from "@/lib/validations";

const dateAtStart = (value: string, tz: number) => new Date(Date.parse(`${value}T00:00:00.000Z`) + tz * 60_000);
const dateAtEnd = (value: string, tz: number) => new Date(Date.parse(`${value}T23:59:59.999Z`) + tz * 60_000);
const addDays = (value: string, count: number) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
};
const monthsBetween = (from: string, to: string) => {
  const months: string[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`);
  const last = `${to.slice(0, 7)}-01`;
  while (cursor.toISOString().slice(0, 10) <= last) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
};

interface CardForecastInputs {
  /** Whether the cards half of the forecast applies at all. False leaves the old model untouched. */
  enabled: boolean;
  /** Card payments already made since the opening balance: real money out, in no transaction row. */
  paymentsMade: number;
  forecastable: ForecastCard[];
  /**
   * Cards that owe but cannot be scheduled. They stay on the old footing -- purchases count when
   * made, payments do not -- because dropping their purchases from cash with no event paying them
   * back is how their debt used to vanish from the forecast.
   */
  unscheduledIds: string[];
  assumptions: string[];
}

const DISABLED_CARDS: CardForecastInputs = {
  enabled: false,
  paymentsMade: 0,
  forecastable: [],
  unscheduledIds: [],
  assumptions: [],
};

/**
 * What the forecast could not schedule, named, and what it did instead.
 *
 * Naming alone is not enough, which is the lesson here: an undated card used to be named while its
 * debt still vanished, because its purchases were dropped from cash with nothing paying them back.
 * These cards stay on the old footing, so the sentence says where their spending went.
 */
const unscheduledCardsAssumption = (noDueDay: string[], noAmount: string[]): string[] => {
  const list = (names: string[]) => names.join(", ");
  const lines: string[] = [];
  if (noDueDay.length > 0) {
    lines.push(`${list(noDueDay)} ${noDueDay.length === 1 ? "has" : "have"} no due day set, so the date of payment is unknown.`);
  }
  if (noAmount.length > 0) {
    lines.push(`${list(noAmount)} ${noAmount.length === 1 ? "has" : "have"} no planned payment, minimum, or three months of payments yet, so the amount is unknown.`);
  }
  if (lines.length === 0) return [];
  return [
    ...lines,
    "Purchases on those cards are counted against your balance on the day they were made instead, and their payments are not projected. Add the missing details on the card to have them scheduled.",
  ];
};

/**
 * What has been paid toward a card's next due date: payments after the previous due date's end,
 * up to today. Zero for a card with no due day, which is not forecast anyway.
 */
const paidSincePreviousDue = (
  payments: { accountId: string; amount: number; date: Date }[],
  account: { id: string; dueDay: number | null },
  today: string,
  tz: number
): number => {
  if (account.dueDay === null) return 0;
  const opened = dateAtEnd(previousDueDate(account.dueDay, today), tz);
  return payments
    .filter((payment) => payment.accountId === account.id && payment.date > opened)
    .reduce((sum, payment) => sum + payment.amount, 0);
};

/**
 * Everything the cards half needs out of the database, in one round trip.
 *
 * Split from `forecastCards` so the fetching and the per-card reasoning can be read separately;
 * the three date bounds here are the part worth reading closely, and they were buried in the
 * middle of the mapping loop.
 */
const readCardLedger = async (
  userId: string,
  ids: string[],
  tz: number,
  window: { openingAt: Date; todayEnd: Date; today: string }
) => {
  const observed = observedPaymentWindow(tz);
  const [purchaseGroups, paymentGroups, recentPayments, settled, cyclePayments] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["creditAccountId"],
      // Bounded to today. A purchase dated next month is not owed yet, and counting it here would
      // schedule a payment for it before it has happened.
      where: { userId, type: "EXPENSE", creditAccountId: { in: ids }, date: { lte: window.todayEnd } },
      _sum: { amount: true },
    }),
    prisma.creditPayment.groupBy({
      by: ["accountId", "kind"],
      // Bounded to today, like purchases. A payment dated next week is not in `paymentsMade`, which
      // stops at today, and emits no event of its own, so counting it here lowered what the card
      // owes today while the money never left the bank anywhere in the forecast.
      where: { userId, accountId: { in: ids }, date: { lte: window.todayEnd } },
      _sum: { amount: true },
    }),
    prisma.creditPayment.findMany({
      where: { userId, accountId: { in: ids }, kind: "PAYMENT", date: { gte: observed.start, lt: observed.end } },
      select: { accountId: true, amount: true, date: true },
    }),
    // Payments already made since the opening balance. Real money out of the bank, in no
    // `transactions` row, so nothing else in this route subtracts them. Not scoped to the cards
    // being forecast: paying off a card that now owes nothing still emptied the account.
    prisma.creditPayment.groupBy({
      by: ["accountId"],
      where: { userId, kind: "PAYMENT", date: { gte: window.openingAt, lte: window.todayEnd } },
      _sum: { amount: true },
    }),
    // Recent enough to cover any card's current cycle, which opens at most a month back; each
    // card then keeps only those after its own previous due date.
    prisma.creditPayment.findMany({
      where: {
        userId, accountId: { in: ids }, kind: "PAYMENT",
        date: { gte: dateAtStart(addDays(window.today, -62), tz), lte: window.todayEnd },
      },
      select: { accountId: true, amount: true, date: true },
    }),
  ]);

  return {
    observed,
    recentPayments,
    totals: foldLedgerGroups(ids, purchaseGroups, paymentGroups),
    paymentsMadeBy: new Map(settled.map((group) => [group.accountId, group._sum.amount ?? 0])),
    cyclePayments,
  };
};

/**
 * The cards whose payments the forecast can place, and what it had to leave out.
 *
 * A card payment is the largest known outflow most accounts have and was counted nowhere: a
 * purchase lowers the tracked balance the day it is made, while the money leaves the bank only when
 * the card is paid. What cannot be placed is *said*, not guessed, because the forecast's output is
 * the lowest projected balance and the day it falls on.
 */
const forecastCards = async (
  userId: string,
  tz: number,
  window: { openingAt: Date; todayEnd: Date; today: string }
): Promise<CardForecastInputs> => {
  // The credit cards switch hides the feature entirely for a user it excludes, so the forecast
  // must not show them a payment line they cannot open, edit or explain -- and must not rebase
  // their tracked balance either, or it would drop card spending with nothing paying it back.
  if (!(await userCanUseCreditCards(prisma, userId))) return DISABLED_CARDS;

  // Archived cards included. `cashOnly` drops *every* card's purchases from the cash balance, so a
  // card left out here had its spending removed with nothing paying it back -- the one-sided rebase
  // cards.md warns against. Deleting a card with history archives it whatever it still owes, the
  // same reason `sumOwedOnCards` and the Debt tab count archived cards. Settled ones drop out below.
  const accounts = await prisma.creditAccount.findMany({
    where: { userId },
    select: {
      id: true, name: true, dueDay: true, billId: true, openingBalance: true, openingBalanceDate: true,
      minimumPaymentPct: true, minimumPaymentFloor: true, plannedPayment: true,
    },
  });
  if (accounts.length === 0) return DISABLED_CARDS;

  const ledger = await readCardLedger(userId, accounts.map((account) => account.id), tz, window);
  const cards: ForecastCard[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    // `openingBalanceAsOf`, as every other balance read does: an opening debt dated after today
    // does not exist yet, so the forecast must not schedule its payment before that date.
    balance: computeAccountBalance(
      openingBalanceAsOf(account, window.todayEnd),
      ledger.totals.get(account.id) ?? { purchases: 0, payments: 0, credits: 0 }
    ),
    dueDay: account.dueDay,
    billId: account.billId,
    plannedPayment: account.plannedPayment,
    observedMonthly: summariseObservedPayments(
      ledger.recentPayments.filter((payment) => payment.accountId === account.id),
      ledger.observed,
      tz
    ).monthly,
    minimumPct: account.minimumPaymentPct,
    minimumFloor: account.minimumPaymentFloor,
    paidThisCycle: paidSincePreviousDue(ledger.cyclePayments, account, window.today, tz),
  }));

  const status = new Map(cards.map((card) => [card.id, scheduleStatus(card)]));
  const unscheduled = cards.filter((card) => {
    const state = status.get(card.id);
    return state === "no-due-day" || state === "no-amount";
  });
  const unscheduledIds = new Set(unscheduled.map((card) => card.id));

  return {
    enabled: true,
    // Only the cards being rebased: an unscheduled card's purchases already came out of cash when
    // they were made, so subtracting its payments as well would take the same money out twice.
    paymentsMade: [...ledger.paymentsMadeBy]
      .filter(([accountId]) => !unscheduledIds.has(accountId))
      .reduce((sum, [, amount]) => sum + amount, 0),
    forecastable: cards.filter((card) => status.get(card.id) === "scheduled"),
    unscheduledIds: [...unscheduledIds],
    assumptions: unscheduledCardsAssumption(
      unscheduled.filter((card) => status.get(card.id) === "no-due-day").map((card) => card.name),
      unscheduled.filter((card) => status.get(card.id) === "no-amount").map((card) => card.name)
    ),
  };
};

const getForecast = async (request: Request, userId: string) => {
  const url = new URL(request.url);
  const parsed = cashFlowForecastQuerySchema.safeParse({ days: url.searchParams.get("days"), tz: url.searchParams.get("tz") });
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid horizon and timezone" }, { status: 400 });
  const { days, tz } = parsed.data;
  const today = localCalendarDay(new Date(), tz);
  const to = addDays(today, days - 1);
  const forecastMonths = monthsBetween(today, to);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { forecastOpeningBalance: true, forecastOpeningBalanceDate: true } });
  if (!user || user.forecastOpeningBalance === null || !user.forecastOpeningBalanceDate) {
    return NextResponse.json({ configured: false, today, horizonDays: days, assumptions: ["Add a dated opening tracked balance before using a forecast. This app does not yet reconcile bank accounts."] });
  }
  const openingDate = user.forecastOpeningBalanceDate.toISOString().slice(0, 10);
  if (openingDate > today) return NextResponse.json({ configured: false, today, horizonDays: days, assumptions: ["The opening tracked balance date cannot be in the future."] });
  const cards = await forecastCards(userId, tz, {
    openingAt: dateAtStart(openingDate, tz),
    todayEnd: dateAtEnd(today, tz),
    today,
  });
  // With cards in play the balance has to be cash-like, or the same money leaves twice: a card
  // purchase is an EXPENSE and already lowers the tracked balance the day it is made, and the
  // payment event would then take it out again. Card purchases are therefore excluded from both
  // transaction paths and the card's whole balance is paid off over the horizon instead. The
  // payments already made are subtracted directly, since they are in no `transactions` row. This
  // is the identity cards.md states, rearranged: cash = tracked + owed - card opening balances.
  // Cards the forecast pays off are taken out of the cash reads; a card it cannot schedule is left in,
  // so its spending counts when it happened rather than nowhere. `OR` with `null` rather than
  // `NOT ... in`: a SQL `NOT IN` is null for a row with no card, and would drop every cash expense.
  const cashOnly = cards.enabled
    ? { OR: [{ creditAccountId: null }, { creditAccountId: { in: cards.unscheduledIds } }] }
    : {};
  const [past, future, schedules, budgets] = await Promise.all([
    prisma.transaction.findMany({ where: { userId, ...cashOnly, date: { gte: dateAtStart(openingDate, tz), lte: dateAtEnd(today, tz) } }, select: { amount: true, type: true } }),
    prisma.transaction.findMany({ where: { userId, ...cashOnly, date: { gte: dateAtStart(addDays(today, 1), tz), lte: dateAtEnd(to, tz) } }, select: { date: true, amount: true, type: true, description: true } }),
    prisma.scheduledTransaction.findMany({ where: { userId, isActive: true, nextDueDate: { lte: new Date(`${to}T00:00:00.000Z`) } }, select: { id: true, amount: true, description: true, type: true, frequency: true, customIntervalDays: true, startDate: true, endDate: true, nextDueDate: true, isVariable: true, transactions: { select: { id: true, date: true, amount: true } }, occurrences: { where: { status: { in: ["PAID", "SKIPPED"] } }, select: { dueDate: true, transactionId: true } } } }),
    Promise.all(forecastMonths.map((month) => getBudgetPerformance(userId, month, tz))),
  ]);
  const current = past.reduce((balance, row) => balance + (row.type === "INCOME" ? row.amount : -row.amount), user.forecastOpeningBalance) - cards.paymentsMade;
  const events: ForecastEvent[] = future.map((row) => ({ date: localCalendarDay(row.date, tz), amount: row.type === "INCOME" ? row.amount : -row.amount, kind: "future-transaction", description: row.description || "Future-dated transaction", estimated: false, assumption: "A transaction already entered for this date." }));
  // PAID occurrence logs identify the scheduled date a linked transaction settled. A payment's
  // transaction date can differ from its due date, so comparing transaction dates is incorrect.
  events.push(...scheduledForecastEvents(schedules.map((schedule) => ({ ...schedule, payments: schedule.transactions })), today, to, tz));
  budgets.forEach((budget) => events.push(...remainingBudgetPaceEvents(budget.month, budget.allocations, today, to)));
  events.push(...cardPaymentEvents(cards.forecastable, today, to));
  const result = buildCashFlowForecast({ openingBalance: current, from: today, to, events });
  return NextResponse.json({ configured: true, today, horizonDays: days, openingBalance: user.forecastOpeningBalance, openingBalanceDate: openingDate, trackedBalanceToday: current, daily: result.days, lowestBalance: result.lowestBalance, cashCrunches: result.cashCrunches, assumptions: ["Projected tracked balance is not a reconciled bank balance.", "Future-dated transactions are treated as committed.", "Fixed bills and income use their schedules; variable bills are estimates based on their own payment history.", "Flexible and Savings budget remaining after logged spending is spread evenly through each month. Unplanned spending, transfers, and account balances are not modeled.", ...(cards.enabled ? ["Because card payments are projected, purchases paid with a card are left out of the balance above and are paid off through their card instead, so the same money is not counted twice. Card payments you have already made are subtracted.", "Credit card payments are projected on each card's due day, from its planned payment, else what you have been paying it, else its minimum. Interest yet to be charged and purchases dated after today are not projected.", "If you also track a card's payment as a recurring bill, it is counted twice here: linking a bill to a card is not built yet, so the forecast cannot tell they are the same payment."] : []), ...cards.assumptions] });
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
