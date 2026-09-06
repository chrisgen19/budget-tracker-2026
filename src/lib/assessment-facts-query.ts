/**
 * Loading half of the AI Assessment's fact layer.
 *
 * Kept apart from `assessment-facts.ts` so every analysis in there stays pure
 * and testable without a database. This module does nothing but fetch rows and
 * resolve them into the user's own calendar days; the judgement lives next door.
 *
 * Two queries, not nine. A personal budget's six-month window is a few thousand
 * rows, and computing in TypeScript keeps one timezone formula in one place
 * rather than repeating it across a dozen `groupBy` calls.
 */
import type { PrismaClient } from "@prisma/client";
import { formatLocalDate } from "@/lib/validations";
import {
  buildAssessmentFacts,
  foldDescription,
  longestToken,
  resolveFactsWindow,
  DEFAULT_HISTORY_MONTHS,
  type FactBill,
  type FactTransaction,
} from "@/lib/assessment-facts";
import type { AssessmentFacts, TransactionType } from "@/types";

export interface FactsParams {
  from: string;
  to: string;
  granularity: string;
  periodLabel: string;
  historyMonths?: number;
}

/** The UTC instant a user-local calendar day starts at. `Date.UTC(...) + tzOffset*60000`, app-wide. */
const localDayStart = (day: string, tzMs: number): Date => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + tzMs);
/** …and the last instant of one, so an inclusive `to` does not drop its own day. */
const localDayEnd = (day: string, tzMs: number): Date => new Date(new Date(`${day}T23:59:59.999Z`).getTime() + tzMs);

/**
 * Compute the assessment's facts for a period.
 *
 * Read-only. Every date is resolved through the user's stored `timezoneOffset`
 * rather than the server clock, so a month here matches the month the app shows.
 */
export const collectAssessmentFacts = async (
  prisma: PrismaClient,
  userId: string,
  params: FactsParams,
): Promise<AssessmentFacts> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true, currency: true },
  });
  const tzOffset = user?.timezoneOffset ?? 0;
  const tzMs = tzOffset * 60_000;
  const today = formatLocalDate(new Date(), tzOffset);
  const historyMonths = params.historyMonths ?? DEFAULT_HISTORY_MONTHS;
  const window = resolveFactsWindow({ from: params.from, to: params.to }, today, historyMonths);

  // The window can end before today (a past period), but bills are judged as of
  // now, so the transaction range always reaches today: a payment logged this
  // week is what tells us last month's bill was settled after all.
  const rangeEnd = window.dataTo > today ? window.dataTo : today;

  const [rows, bills, firstSightings, allTime] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: localDayStart(window.dataFrom, tzMs), lte: localDayEnd(rangeEnd, tzMs) } },
      select: {
        id: true,
        amount: true,
        type: true,
        date: true,
        description: true,
        categoryId: true,
        billId: true,
        category: { select: { name: true } },
        // Only the count is needed, and `_count` avoids pulling a row per label:
        // the amount split across several labels is a question for
        // `getLabelBreakdown`, never for a naive join here.
        _count: { select: { labels: true } },
      },
    }),
    prisma.scheduledTransaction.findMany({
      where: { userId, isActive: true },
      select: {
        id: true,
        description: true,
        amount: true,
        isVariable: true,
        frequency: true,
        customIntervalDays: true,
        startDate: true,
        nextDueDate: true,
        endDate: true,
        category: { select: { name: true } },
        // A bill is judged against every payment it ever took, not the window's:
        // last June is what says what next June will cost.
        transactions: { select: { id: true, date: true, amount: true } },
        occurrences: { select: { dueDate: true, status: true, transactionId: true, snoozeUntil: true } },
      },
    }),
    // When each description was *first* ever seen, across the user's whole
    // history rather than the window. Without it every charge older than the
    // window reads as new, since the window's own first row is all there is to
    // see -- a subscription running for two years looked 120 days old. Grouped
    // in Postgres so the answer costs one narrow result set, not every row the
    // user has ever written.
    prisma.transaction.groupBy({
      by: ["description"],
      where: { userId, type: "EXPENSE" },
      _min: { date: true },
    }),
    // Every row the user has, for the running balance. A balance is not a window:
    // six months of it is a period's net, which answers a different question.
    prisma.transaction.groupBy({ by: ["type"], where: { userId }, _sum: { amount: true } }),
  ]);

  // Folded here rather than in SQL: `groupBy` is exact, and "Netflix " and
  // "netflix" have to collapse the same way `computeRecurring` collapses them.
  const historyFirstSeen = new Map<string, string>();
  for (const row of firstSightings) {
    if (!row._min.date) continue;
    const key = foldDescription(row.description ?? "");
    if (!key) continue;
    const day = formatLocalDate(row._min.date, tzOffset);
    const existing = historyFirstSeen.get(key);
    if (!existing || day < existing) historyFirstSeen.set(key, day);
  }

  const transactions: FactTransaction[] = rows.map((t) => ({
    id: t.id,
    amount: t.amount,
    type: t.type as TransactionType,
    localDate: formatLocalDate(t.date, tzOffset),
    description: t.description ?? "",
    categoryId: t.categoryId,
    categoryName: t.category.name,
    billId: t.billId,
    labelCount: t._count.labels,
  }));

  // Payments named after a bill but carrying no `billId`, across all history. The
  // window would clip the finding: a payment made outside the bill system while
  // that bill existed left its schedule stalled, and it stays stalled.
  //
  // Prefiltered on the bill name's longest **token**, not on the name itself.
  //
  // Descriptions are never trimmed or normalised on write: one real account holds
  // nine rows with leading or trailing whitespace and two with a double space
  // inside. SQL equality does no trimming, so `equals` dropped exactly the rows
  // `foldDescription` exists to catch -- and `contains` of the whole name still
  // misses "Mirea  Rent", because that string does not contain "Mirea Rent".
  // A single token survives every spacing variant the fold would normalise, and
  // the fold-match in `findUnlinkedBillPayments` narrows the extras back out, so
  // a "Meralco payment" fetched here is still rejected there.
  const billNames = [...new Set(bills.map((b) => (b.description || b.category.name).trim()).filter(Boolean))];
  const unlinkedRows = billNames.length === 0
    ? []
    : await prisma.transaction.findMany({
        where: {
          userId,
          billId: null,
          type: "EXPENSE",
          OR: billNames.map((name) => ({ description: { contains: longestToken(name), mode: "insensitive" as const } })),
        },
        select: {
          id: true, amount: true, type: true, date: true, description: true,
          categoryId: true, billId: true, category: { select: { name: true } },
        },
      });

  const factBills: FactBill[] = bills.map((b) => ({
    id: b.id,
    description: b.description || b.category.name,
    categoryName: b.category.name,
    amount: b.amount,
    isVariable: b.isVariable,
    frequency: b.frequency,
    customIntervalDays: b.customIntervalDays,
    startDate: b.startDate,
    nextDueDate: b.nextDueDate,
    endDate: b.endDate,
    payments: b.transactions,
    occurrences: b.occurrences,
  }));

  const unlinkedCandidates: FactTransaction[] = unlinkedRows.map((t) => ({
    id: t.id,
    amount: t.amount,
    type: t.type as TransactionType,
    localDate: formatLocalDate(t.date, tzOffset),
    description: t.description ?? "",
    categoryId: t.categoryId,
    categoryName: t.category.name,
    billId: t.billId,
    // Not read by the unlinked check, which asks only whether a payment bypassed
    // its bill. Left at zero rather than joined for a field nothing consults.
    labelCount: 0,
  }));

  const totalOf = (type: "INCOME" | "EXPENSE") =>
    allTime.find((row) => row.type === type)?._sum.amount ?? 0;

  return buildAssessmentFacts({
    currency: user?.currency ?? "PHP",
    period: { from: params.from, to: params.to, label: params.periodLabel, granularity: params.granularity },
    today,
    timezoneOffset: tzOffset,
    historyMonths,
    transactions,
    bills: factBills,
    historyFirstSeen,
    allTimeTotals: { income: totalOf("INCOME"), expenses: totalOf("EXPENSE") },
    unlinkedCandidates,
  });
};
