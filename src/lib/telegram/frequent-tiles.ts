import { foldDescription } from "@/lib/assessment-facts";

/**
 * The Frequent section of the quick-log grid: buttons nobody configured, derived from what the
 * user actually logs.
 *
 * Configured tiles answer "what do I spend on every day", which someone has to sit down and
 * decide. This answers the same question from the ledger, and keeps answering it as the habits
 * change. It is the part of the grid that needs no maintenance.
 *
 * Pure, over injected rows, so every rule below is testable without a database -- the shape
 * `assessment-facts.ts` uses for the same reason. The loader lives in `frequent-tiles-query.ts`.
 */

/** How far back "frequent" looks. */
export const FREQUENT_WINDOW_DAYS = 60;

/**
 * How many times something has to appear before it earns a button.
 *
 * Twice is a coincidence. Three times inside two months is a habit, and a habit is the only thing
 * worth a permanent-looking button on a grid people navigate by muscle memory.
 */
export const FREQUENT_MIN_COUNT = 3;

/** Two rows of a three-column grid. Past that, finding the right button becomes reading. */
export const FREQUENT_LIMIT = 6;

/**
 * How much of a group's history the modal amount has to cover before one tap may log it.
 *
 * The rule this enforces: **the user may assert a fixed amount; the system may never infer one.**
 * A configured tile carrying 38 is the user's own claim about a fare. A derived tile carrying 38
 * is this module's guess, and a guess that writes itself into the ledger on one tap is the class
 * of silent wrongness the whole codebase keeps refusing.
 *
 * So a derived amount is only offered as a one-tap default when it is overwhelmingly the amount
 * paid. Below that the tile still appears -- the description is still worth not typing -- but the
 * pad opens and asks.
 */
export const FREQUENT_STABLE_SHARE = 0.6;

/** One transaction, as the loader supplies it. */
export interface FrequentSource {
  description: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  date: Date;
}

export interface FrequentTile {
  /** `foldDescription(description)`. The React key, and the key deduped against configured tiles. */
  key: string;
  /** The most recent spelling the user actually wrote, which is the one they currently use. */
  description: string;
  /** Occurrences in the window. Shown, because "4x" is the whole reason the tile is there. */
  count: number;
  /** The amount paid most often. Null when nothing repeats often enough to offer. */
  amount: number | null;
  /** Whether `amount` may be logged on a single tap. See `FREQUENT_STABLE_SHARE`. */
  amountIsStable: boolean;
  categoryId: string;
  categoryName: string;
  lastLoggedAt: Date;
}

export interface FrequentOptions {
  /** Folded descriptions of the user's configured tiles, which must not appear twice in the grid. */
  excludeKeys?: string[];
  limit?: number;
  minCount?: number;
}

/**
 * Rank the user's recent spending into quick-log tiles.
 *
 * Rows are grouped by `foldDescription`, which is imported rather than re-implemented: AGENTS.md
 * is explicit that a second folding rule is drift, and this needs exactly the property that rule
 * exists for. iOS substitutes U+2019 for a typed apostrophe, so one merchant is written two ways
 * by the same person on the same phone, and unfolded they would each fall below the threshold and
 * neither would appear.
 *
 * The caller is responsible for the window and for excluding bill payments and receipt splits --
 * those are predicates the database can apply, and applying them here would mean loading rows only
 * to discard them.
 */
export const deriveFrequentTiles = (
  rows: FrequentSource[],
  { excludeKeys = [], limit = FREQUENT_LIMIT, minCount = FREQUENT_MIN_COUNT }: FrequentOptions = {}
): FrequentTile[] => {
  const excluded = new Set(excludeKeys.map(foldDescription));

  const groups = new Map<
    string,
    { rows: FrequentSource[]; latest: FrequentSource }
  >();

  for (const row of rows) {
    const key = foldDescription(row.description);
    if (!key || excluded.has(key)) continue;

    const group = groups.get(key);
    if (!group) {
      groups.set(key, { rows: [row], latest: row });
      continue;
    }
    group.rows.push(row);
    // Tracked as we go rather than sorting afterwards: the caller's ordering is not something this
    // function should have to depend on.
    if (row.date > group.latest.date) group.latest = row;
  }

  const tiles: FrequentTile[] = [];

  for (const [key, group] of groups) {
    if (group.rows.length < minCount) continue;

    const { amount, share } = modalAmount(group.rows);
    const category = modalCategory(group.rows);

    tiles.push({
      key,
      // The most recent spelling, not the folded key and not the most common one. If someone has
      // started writing it differently, that is the version they will recognise on a button.
      description: group.latest.description.trim(),
      count: group.rows.length,
      amount,
      amountIsStable: amount !== null && share >= FREQUENT_STABLE_SHARE,
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      lastLoggedAt: group.latest.date,
    });
  }

  return tiles
    .sort((a, b) => b.count - a.count || b.lastLoggedAt.getTime() - a.lastLoggedAt.getTime())
    .slice(0, limit);
};

/**
 * The amount paid most often, and what share of the group paid it.
 *
 * The mode, deliberately, and neither of the two averages that suggest themselves:
 *
 * A **mean** is dragged by a single outlier. Three 38-peso fares and one 3,000-peso airport trip
 * average to 778, which is not a fare and is not anything.
 *
 * A **median** is worse in the specific case this feature exists for, because it invents a figure
 * nobody paid. A commute logged as one description at 38 out and 80 home has a median of 59.
 *
 * The mode is literally "what this usually costs", and it is always a real amount from a real row.
 *
 * Rounded to 2dp before grouping. `amount` is a `Float`, so two rows that were both entered as
 * 38.00 can differ in the last bits and count as separate amounts, which would collapse the share
 * and make a perfectly stable fare look unstable.
 */
const modalAmount = (rows: FrequentSource[]): { amount: number | null; share: number } => {
  const counts = new Map<number, { count: number; latest: number }>();

  for (const row of rows) {
    const value = Math.round(row.amount * 100) / 100;
    const seen = counts.get(value);
    const at = row.date.getTime();
    if (!seen) {
      counts.set(value, { count: 1, latest: at });
      continue;
    }
    seen.count += 1;
    if (at > seen.latest) seen.latest = at;
  }

  let best: { amount: number; count: number; latest: number } | null = null;

  for (const [amount, { count, latest }] of counts) {
    // Ties break by recency. Two amounts paid equally often means the habit is changing, and the
    // newer one is the better guess at what the next tap means.
    if (!best || count > best.count || (count === best.count && latest > best.latest)) {
      best = { amount, count, latest };
    }
  }

  if (!best) return { amount: null, share: 0 };

  return { amount: best.amount, share: best.count / rows.length };
};

/**
 * The category most of these rows were filed under.
 *
 * Always resolvable, and worth knowing why: `transactions.categoryId` is `onDelete: Restrict`, so
 * a category with transactions cannot be deleted. A derived tile therefore can never carry a
 * dangling category, which is the one way it is better off than a configured one.
 */
const modalCategory = (rows: FrequentSource[]): { categoryId: string; categoryName: string } => {
  const counts = new Map<string, { name: string; count: number }>();

  for (const row of rows) {
    const seen = counts.get(row.categoryId);
    if (seen) seen.count += 1;
    else counts.set(row.categoryId, { name: row.categoryName, count: 1 });
  }

  let best: { id: string; name: string; count: number } | null = null;
  for (const [id, { name, count }] of counts) {
    if (!best || count > best.count) best = { id, name, count };
  }

  return { categoryId: best!.id, categoryName: best!.name };
};
