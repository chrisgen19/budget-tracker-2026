import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCreditCardsUser } from "@/lib/credit-account-http";
import {
  getCreditAccountSummaries,
  monthsInRange,
  observedPaymentWindow,
  owedByMonth,
  readTimezoneOffset,
  summariseObservedPayments,
} from "@/lib/credit-account-queries";
import { INTEREST_CATEGORY_NAME } from "@/lib/card-interest";
import { compareStrategies, minimumDue, type StrategyCard } from "@/lib/debt-payoff";
import { debtAnalyticsQuerySchema } from "@/lib/validations";

/**
 * The portfolio view of what the cards owe.
 *
 * A sibling route rather than a slice of `/api/analytics`, which is already the fat one carrying
 * row-count telemetry: the precedent is `/api/cash-flow-forecast`. It answers only what is
 * meaningless on a single card's page -- the total, its trend, interest across all cards, and the
 * two payoff orderings raced against each other.
 *
 * Opens with `requireCreditCardsUser`, so a user the switch excludes gets 403 `FEATURE_DISABLED`
 * rather than an empty report. The tab is hidden for them too; a tab that 403s is worse than none.
 */

/**
 * A user-local calendar day as the instants bounding it, by the one formula the app uses:
 * `Date.UTC(y, m, d) + tzOffset * 60000`. Bare `T00:00:00Z` bounds are UTC's day, not the user's,
 * and AGENTS.md is explicit that a caller forgetting the offset gets silently wrong months -- in
 * Manila an interest charge logged at 07:00 on the 1st would fall into the previous month.
 */
const dayStart = (day: string, tz: number): Date =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) + tz * 60_000);
const dayEnd = (day: string, tz: number): Date => new Date(dayStart(day, tz).getTime() + 86_400_000 - 1);

export async function GET(request: Request) {
  const userId = await requireCreditCardsUser();
  if (userId instanceof NextResponse) return userId;

  try {
    const url = new URL(request.url);
    const parsed = debtAnalyticsQuerySchema.safeParse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid date range" }, { status: 400 });
    const { from, to } = parsed.data;

    const tz = await readTimezoneOffset(prisma, userId);
    // Archived cards included: deleting a card with history archives it whatever it still owes, so
    // leaving them out would drop real debt from the total. `sumOwedOnCards` makes the same call.
    const cards = await getCreditAccountSummaries(prisma, userId, { includeArchived: true });
    const owing = cards.filter((card) => card.balance > 0);
    const ids = cards.map((card) => card.id);

    const observed = observedPaymentWindow(tz);
    const [interest, interestEver, purchases, payments, recentPayments] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          userId, type: "EXPENSE", creditAccountId: { in: ids },
          category: { name: INTEREST_CATEGORY_NAME },
          date: { gte: dayStart(from, tz), lte: dayEnd(to, tz) },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.count({
        where: { userId, type: "EXPENSE", creditAccountId: { in: ids }, category: { name: INTEREST_CATEGORY_NAME } },
      }),
      // Bounded at the end of the range, since rows after it feed no trend point -- true because
      // `owedByMonth` measures the last point at `to` as well, not at its month's end. Not bounded
      // below: the first month's balance is built from the whole history up to it.
      prisma.transaction.findMany({
        where: { userId, type: "EXPENSE", creditAccountId: { in: ids }, date: { lte: dayEnd(to, tz) } },
        select: { creditAccountId: true, amount: true, date: true },
      }),
      prisma.creditPayment.findMany({
        where: { userId, accountId: { in: ids }, date: { lte: dayEnd(to, tz) } },
        select: { accountId: true, amount: true, date: true, kind: true },
      }),
      prisma.creditPayment.findMany({
        where: { userId, accountId: { in: ids }, kind: "PAYMENT", date: { gte: observed.start, lt: observed.end } },
        select: { accountId: true, amount: true, date: true },
      }),
    ]);

    // Measured at `to`, the same instant the reads above stop at, so the last point and the rows
    // behind it cannot disagree about where the range ends.
    const owedOverTime = owedByMonth(cards, purchases, payments, monthsInRange(from, to), tz, dayEnd(to, tz));

    const racers: StrategyCard[] = owing
      .filter((card) => card.apr !== null)
      .map((card) => ({
        id: card.id, name: card.name, balance: card.balance, apr: card.apr!,
        minimumPct: card.minimumPaymentPct, minimumFloor: card.minimumPaymentFloor,
      }));
    // What the account actually puts against the cards each month: the same preference order the
    // forecast uses, so the two cannot disagree about the money available.
    // Only the cards in the race fund it. A card with no APR is left out of `racers`, and counting
    // its payment into the pool anyway handed the racing cards money that is really going elsewhere,
    // shortening both orderings and able to turn a stall into a clear.
    const racing = new Set(racers.map((card) => card.id));
    const monthlyPool = owing.filter((card) => racing.has(card.id)).reduce((sum, card) => {
      const observedMonthly = summariseObservedPayments(
        recentPayments.filter((payment) => payment.accountId === card.id), observed, tz
      ).monthly;
      return sum + (card.plannedPayment ?? observedMonthly ?? minimumDue(card.balance, card.minimumPaymentPct, card.minimumPaymentFloor) ?? 0);
    }, 0);

    return NextResponse.json({
      totalOwed: Math.round(owing.reduce((sum, card) => sum + card.balance, 0) * 100) / 100,
      owedOverTime,
      // Never logged and none this period are different answers; see `describeCardInterest`.
      interest: { period: Math.round((interest._sum.amount ?? 0) * 100) / 100, everLogged: interestEver > 0 },
      cards: owing.map((card) => ({
        id: card.id, name: card.name, balance: card.balance, utilization: card.utilization,
        apr: card.apr, creditLimit: card.creditLimit, isActive: card.isActive,
        plannedPayment: card.plannedPayment,
        minimumPaymentPct: card.minimumPaymentPct, minimumPaymentFloor: card.minimumPaymentFloor,
        observedMonthly: summariseObservedPayments(
          recentPayments.filter((payment) => payment.accountId === card.id), observed, tz
        ).monthly,
      })),
      strategies: compareStrategies(racers, monthlyPool),
    });
  } catch {
    return NextResponse.json({ error: "Failed to load debt analytics" }, { status: 500 });
  }
}
