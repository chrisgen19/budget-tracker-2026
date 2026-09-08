import type { PrismaClient } from "@/lib/budget-query-types";
import {
  FREQUENT_WINDOW_DAYS,
  deriveFrequentTiles,
  type FrequentOptions,
  type FrequentTile,
} from "@/lib/telegram/frequent-tiles";

/**
 * The loader behind the Frequent section of the quick-log grid.
 *
 * Split from the ranking in `frequent-tiles.ts` so the rules there are testable against hand-built
 * rows, the shape `assessment-facts.ts` and `assessment-facts-query.ts` already use. What lives
 * here is only what the database has to decide: the window and the three exclusions.
 *
 * `prisma` is injected rather than imported, matching `budget-queries.ts`, so a caller can supply
 * its own client.
 */

/**
 * A ceiling on how many rows are pulled back.
 *
 * The ranking is O(rows) and the window is bounded, but "bounded" here is bounded by how much
 * somebody logs, not by anything this code controls. A busy two months is a few hundred rows; ten
 * thousand would mean something has gone wrong upstream, and reading them all to build six buttons
 * is not the way to find out. Newest-first, so the cap drops the oldest rows -- the ones least
 * likely to describe a current habit.
 */
const MAX_ROWS = 1_000;

/**
 * Derive the Frequent tiles for one user.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention (UTC+8 is -480). Required and
 *   not defaulted: `budget-queries.ts` defaults it to UTC and AGENTS.md records the cost -- a
 *   caller that forgets gets silently wrong day boundaries rather than a type error. This is read
 *   from `users.timezone_offset`, never from `TELEGRAM_TZ_OFFSET`, which describes the bot's
 *   prompt clock and would be a second source of truth for the same fact.
 */
export const loadFrequentTiles = async (
  prisma: PrismaClient,
  userId: string,
  timezoneOffset: number,
  options: FrequentOptions & { now?: Date; windowDays?: number } = {}
): Promise<FrequentTile[]> => {
  const { now = new Date(), windowDays = FREQUENT_WINDOW_DAYS, ...ranking } = options;

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      // Income that repeats is salary: monthly, large, and a mis-tap on it writes a wrong figure
      // worth a hundred fares. Nothing about this grid is for logging income.
      type: "EXPENSE",
      // Bounded at both ends. A lower bound alone makes this "the last 60 days, plus all of the
      // future", and nothing in the app stops a row landing there: `transactionSchema.date` is
      // `z.string().min(1)`, and neither the batch route nor `create_transactions` adds a ceiling.
      // Such a row would satisfy `gte` for as long as it takes reality to catch up, never ageing
      // out of a window whose whole premise is recency -- and it would sort first under
      // `date: desc` and eat the row cap ahead of genuine history.
      date: {
        // `windowDays - 1`, because the upper bound already includes the whole of today. Counting
        // back a full `windowDays` from today spans `windowDays + 1` calendar days, which is not
        // what the constant says and is a day of history nobody asked for. Small in effect and
        // worth being exact about: the threshold is three occurrences, so one extra boundary day
        // can be the difference between a tile appearing and not.
        gte: localDayStart(now, timezoneOffset, windowDays - 1),
        lte: localDayEnd(now, timezoneOffset),
      },
      // A tile writing a plain transaction with no `bill_id` settles no occurrence and does not
      // advance the schedule cursor, so a "Meralco" button would manufacture exactly the finding
      // `findUnlinkedBillPayments` exists to report. Bills are settled through `settleBill`.
      billId: null,
      // Three rows from one split receipt are one purchase. Their descriptions are category names
      // rather than things anyone re-buys, and a weekly grocery run would otherwise occupy half
      // the grid with fragments of itself.
      receiptGroupId: null,
    },
    select: {
      description: true,
      amount: true,
      date: true,
      categoryId: true,
      category: { select: { name: true } },
    },
    orderBy: { date: "desc" },
    take: MAX_ROWS,
  });

  return deriveFrequentTiles(
    rows.map((r) => ({
      description: r.description,
      amount: r.amount,
      date: r.date,
      categoryId: r.categoryId,
      categoryName: r.category.name,
    })),
    ranking
  );
};

/**
 * The user's calendar day, as UTC components.
 *
 * The app-wide approach: shift the instant by the offset and then read UTC parts, so the result is
 * the account's day rather than the container's. Not `toISOString().slice(0, 10)`, which is UTC's
 * day, and not `setDate(getDate() - n)`, which works in the *process* zone -- UTC in the
 * container, and nobody's calendar.
 */
const localParts = (now: Date, timezoneOffset: number) => {
  const local = new Date(now.getTime() - timezoneOffset * 60_000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
};

/** Midnight, `daysAgo` days back, in the user's own calendar. */
const localDayStart = (now: Date, timezoneOffset: number, daysAgo: number): Date => {
  const { y, m, d } = localParts(now, timezoneOffset);
  return new Date(Date.UTC(y, m, d - daysAgo) + timezoneOffset * 60_000);
};

/**
 * The last instant of the user's today.
 *
 * `23:59:59.999` rather than `now`, matching `resolvePeriod`'s rule that both bounds are inclusive
 * local days -- AGENTS.md puts it as an end resolved to midnight silently dropping the last day of
 * every window. The lower bound here is a day boundary, so the upper one has to be as well.
 *
 * The practical difference from `lte: now`: a row entered this morning for something later today
 * would be excluded until the evening and then appear, so a tile would come and go during the day.
 * That is harder to trust than either answer given consistently.
 */
const localDayEnd = (now: Date, timezoneOffset: number): Date => {
  const { y, m, d } = localParts(now, timezoneOffset);
  return new Date(Date.UTC(y, m, d, 23, 59, 59, 999) + timezoneOffset * 60_000);
};
