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

/**
 * The grouping key: `foldDescription`, tokenised, **in the order written**.
 *
 * `foldDescription` is an exact match once case, typographic apostrophes and repeated whitespace
 * are normalised, and that is all it is meant to be -- #250 and #252 stretched it to apostrophes
 * and deliberately stopped there. It is also imported by `assessment-facts.ts`, where it drives
 * duplicate detection, recurring-charge creep and income concentration, so it must not learn
 * anything about this surface. The key lives here, under its own name, built on top of that rule
 * rather than beside it: AGENTS.md warns against a second copy of the *same* folding rule, and this
 * is a different one.
 *
 * **Word order is preserved, and two review rounds are the reason.** Sorting the tokens is the
 * obvious way to collapse `uv & jeep` and `jeep & uv`, and it was tried twice:
 *
 *  1. Sorting unconditionally merged `Office to House` with `House to Office`.
 *  2. Sorting only across a conjunction merged `Office & House fare` with `House & Office fare`.
 *
 * Neither is a cosmetic merge. Six 38 trips out and three 80 trips back become nine rows whose
 * modal amount is 38 at a 67% share, which clears `FREQUENT_STABLE_SHARE`, while `description` is
 * the most recent spelling -- so the tile reads as the *return* trip and one-taps the *outbound*
 * fare. A wrong fare, written with no confirmation, which is precisely what
 * `deriveFrequentTiles` refuses to let a merge do.
 *
 * The lesson is that **commutativity cannot be read off the text**. `&` joins two things; whether
 * their order carries meaning is semantics no token test can see, and each attempt to guess it was
 * breached by a phrasing the previous one had not considered. A third heuristic would be a third
 * guess.
 *
 * So sorting is gone, and nothing is lost that was actually being gained: on the real ledger the
 * output is identical either way, because `containsEitherWay` already suppresses `uv & jeep` and
 * `jeep & uv` under the `uv express & jeep fare` that contains both. What remains is a narrower
 * gap -- two bare order-variants with no containing superset each keep a slot -- and that costs a
 * slot on a grid, where the merge cost a fare in the ledger. Those are not comparable, and this
 * module already picks the visible mistake over the silent one.
 *
 * `&` is a separator rather than a token because it is punctuation people type inconsistently in
 * exactly the descriptions this exists for. `UV & Jeep` and `UV and Jeep` therefore do not merge --
 * `&` is gone from the tokens while `and` survives as one -- a real gap and deliberately not closed:
 * dropping `and` as a stopword would also cut `S&R` down to two one-letter tokens.
 */
export const frequentKey = (description: string): string =>
  tokensOf(foldDescription(description)).join(" ");

/**
 * The words of an already-folded description. Split on `&` as well as whitespace.
 *
 * Takes folded input rather than folding again, so the fold happens once at the one call site that
 * owns it and there is no chance of two folds disagreeing.
 *
 * A token carrying no letter or digit is dropped, which is what keeps a dash from counting as a
 * word: `UV Express - Office to House` is a real tile description here, and a bare `-` in its set
 * would stop it containing anything it should. Tested with `\p{L}`/`\p{N}` rather than `a-z0-9`
 * because descriptions here are not ASCII-only -- splitting on non-ASCII would cut `Piñata` in
 * half, and hyphenated words must survive whole for the same reason.
 */
const tokensOf = (folded: string): string[] =>
  folded.split(/[\s&]+/).filter((token) => /[\p{L}\p{N}]/u.test(token));

/**
 * Whether one key's words are a subset of the other's, in either direction.
 *
 * The suppression rule, and a set relation rather than a score -- there is no threshold to tune and
 * no pair it answers "maybe" for. `uv & jeep` is contained by `uv express & jeep fare`; `gsm green`
 * contains nothing but is contained by `gsm green ride`. Both directions matter because ranking is
 * by count, not by length: the survivor is whichever is logged more, which is sometimes the shorter
 * description and sometimes the longer.
 *
 * **Equal-sized token sets are never a duplicate.** Gating the sort in `frequentKey` is not enough
 * on its own, because this compares *sets* and `{office, to, house}` equals `{house, to, office}`:
 * two directions would survive grouping and then be collapsed here instead, suppressing one real
 * trip in favour of the other. Given the keys differ, equal sizes mean either the same words in a
 * different order -- a direction pair -- or two sets neither of which can contain the other, and
 * the answer is `false` for both.
 */
const containsEitherWay = (a: string, b: string): boolean => {
  if (a === b) return true;

  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return false;
  if (ta.size === tb.size) return false;

  const [small, large] = ta.size < tb.size ? [ta, tb] : [tb, ta];
  for (const token of small) if (!large.has(token)) return false;
  return true;
};

/** One transaction, as the loader supplies it. */
export interface FrequentSource {
  description: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  date: Date;
}

export interface FrequentTile {
  /** `frequentKey(description)`. The React key, and the key deduped against configured tiles. */
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
  /**
   * Descriptions of the user's configured tiles, which must not appear twice in the grid.
   *
   * Raw descriptions rather than pre-folded keys: they are folded here, so a caller cannot pass
   * one folded by a rule that has since moved on. Matched by containment as well as equality, so
   * configuring `UV Express & Jeep fare` also clears `uv & jeep`.
   */
  excludeKeys?: string[];
  limit?: number;
  minCount?: number;
}

/**
 * Rank the user's recent spending into quick-log tiles.
 *
 * Rows are grouped by `frequentKey`, which builds on `foldDescription` rather than
 * re-implementing it: AGENTS.md is explicit that a second copy of that rule is drift, and this
 * needs exactly the property it exists for. iOS substitutes U+2019 for a typed apostrophe, so one
 * merchant is written two ways by the same person on the same phone, and unfolded they would each
 * fall below the threshold and neither would appear.
 *
 * One further rule keeps one habit from taking several slots (#268), because a grid meant to
 * surface six things was surfacing two: after ranking, a tile whose words are contained by -- or
 * contain -- a **higher-ranked** tile's loses its slot.
 *
 * **Word order is not part of that rule, and must not become part of it.** Sorting the tokens is
 * the obvious way to collapse `uv & jeep` and `jeep & uv`; `frequentKey` records why both attempts
 * merged a *direction* instead and were reverted, and why a third guess at commutativity would fare
 * no better. Nothing was lost by dropping it: containment already suppresses that pair under the
 * `uv express & jeep fare` that contains both.
 *
 * Suppression is deliberately not merging. Merging is the obvious reading of
 * "deduplicate" and is wrong here: `gsm green` and `gsm green ride` carry modes of 231.5 and 247,
 * so a merge has to pick between two real amounts, and `description` is deliberately the most
 * recent spelling, so a plain trip could end up captioned with the longer variant. The two
 * mistakes do not cost the same -- a wrong suppression loses a button, which is visible on the grid
 * and recoverable in the editor, where a wrong merge offers a wrong amount under a wrong
 * description and one tap writes it. Suppression also keeps every `count` honest, since an absorbed
 * group's occurrences never move to the survivor.
 *
 * The caller is responsible for the window and for excluding bill payments and receipt splits --
 * those are predicates the database can apply, and applying them here would mean loading rows only
 * to discard them.
 */
export const deriveFrequentTiles = (
  rows: FrequentSource[],
  { excludeKeys = [], limit = FREQUENT_LIMIT, minCount = FREQUENT_MIN_COUNT }: FrequentOptions = {}
): FrequentTile[] => {
  // Folded the same way the rows are, and then matched by containment too. Exact-matching the
  // exclusion list is what let a variant sit in Frequent underneath the very tile a user had
  // configured to replace it -- the redundancy surviving the one action taken to fix it.
  const excluded = excludeKeys.map(frequentKey).filter(Boolean);

  const groups = new Map<
    string,
    { rows: FrequentSource[]; latest: FrequentSource }
  >();

  for (const row of rows) {
    const key = frequentKey(row.description);
    if (!key || excluded.some((e) => containsEitherWay(e, key))) continue;

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

  // The key breaks a remaining tie, and it is not cosmetic. Ranking used to decide only the *order*
  // of two tiles that both appeared, so `Array.prototype.sort`'s stability was enough and a tie
  // fell back to the caller's row order harmlessly. Suppression made a tie decide which tile
  // *exists*: two contained groups with equal counts and an equal `lastLoggedAt` would otherwise
  // keep whichever came first in `rows`, so reversing identical input swapped `Grab` (100) for
  // `Grab to airport` (900) -- a ninefold difference in the amount offered, chosen by row order, in
  // a module that promises not to depend on it.
  const ranked = tiles.sort(
    (a, b) =>
      b.count - a.count ||
      b.lastLoggedAt.getTime() - a.lastLoggedAt.getTime() ||
      (a.key > b.key ? 1 : a.key < b.key ? -1 : 0)
  );

  // Floored and clamped rather than trusted. The cap was `.slice(0, limit)`, which quietly absorbed
  // a zero and a fractional value; moving it into the loop as `=== limit` meant neither ever
  // matched, so `limit: 0` returned the whole list instead of nothing.
  const cap = Math.max(0, Math.floor(limit));

  // Suppression runs on the *ranked* list and before the limit, so the survivor is whichever is
  // logged more and a suppressed variant hands its slot to the next real habit rather than leaving
  // a hole. Applying the cap first would have kept the variant and dropped the habit, which is the
  // bug: `Pandesal` was pushed off the bottom by a second spelling of a button already on the grid.
  const kept: FrequentTile[] = [];
  for (const tile of ranked) {
    if (kept.length >= cap) break;
    if (kept.some((k) => containsEitherWay(k.key, tile.key))) continue;
    kept.push(tile);
  }

  return kept;
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
