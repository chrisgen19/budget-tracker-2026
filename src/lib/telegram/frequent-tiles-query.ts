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
      date: { gte: windowStart(now, timezoneOffset, windowDays) },
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
 * Midnight, `windowDays` ago, in the user's own calendar.
 *
 * The app-wide formula, `Date.UTC(y, m, d) + tzOffset * 60000`. Not `toISOString().slice(0, 10)`
 * and not `setDate(getDate() - n)`: the first is UTC's day rather than the account's, and the
 * second works in the *process* zone, which is UTC in the container and is nobody's calendar.
 */
const windowStart = (now: Date, timezoneOffset: number, windowDays: number): Date => {
  const local = new Date(now.getTime() - timezoneOffset * 60_000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - windowDays) +
      timezoneOffset * 60_000
  );
};
