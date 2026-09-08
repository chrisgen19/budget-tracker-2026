import { findOtherCategory, matchCategory, type BotCategory } from "@/lib/telegram/category-match";

/**
 * Deciding which category a quick-log tile writes to.
 *
 * This is the runtime successor to a compile-time guarantee. `quick-keyboard.test.ts` can assert
 * that `38 fare to office` resolves to Transportation and not to Housing, because `QUICK_FARES` is
 * a three-element `as const` list checked against the real matcher at build time. Once tiles are
 * user data there is no build-time list, so the same property has to be answered at three runtime
 * moments instead:
 *
 *  - when a tile is **saved**, so the editor can say "this will file under Other Expense" before
 *    the user commits to it
 *  - when the grid is **read**, so a tile whose category was deleted while the app was closed is
 *    visibly degraded rather than degraded on the next tap
 *  - when a tap is **logged**, so the confirmation names the category actually written
 *
 * One function answers all three, which is what stops the editor's promise and the write's
 * behaviour drifting apart.
 */

/**
 * How many tiles one person may have.
 *
 * A grid is a scanning problem past a certain size, and the whole point is that the right button
 * is found without reading. Twelve is four rows of three on a phone. Sized like
 * `MAX_QUICK_CATEGORIES` and `MAX_QUICK_LABELS`, and lives here for the same reason they live in
 * `src/lib/`: an API route can import it without pulling in a client component.
 */
export const MAX_QUICK_TILES = 12;

/** The parts of a tile that decide where it files. */
export interface TileCategoryInput {
  description: string;
  type: "EXPENSE" | "INCOME";
  categoryId: string | null;
}

/**
 * Where a tile files, and how that was decided.
 *
 * `via` exists so callers can tell the user. An inference they cannot see is one they cannot undo,
 * which is the same rule the repaired receipt year and the Telegram caption hint already follow.
 */
export interface TileCategoryResolution {
  categoryId: string;
  categoryName: string;
  /** `tile` = the stored choice held. `matched` / `other` = it did not, and this is the fallback. */
  via: "tile" | "matched" | "other";
}

/**
 * Resolve a tile's category against the categories that actually exist right now.
 *
 * The ladder is the shorthand path's, not a new one: an explicit choice beats a guess, a guess
 * beats nothing, and "Other" is the honest floor.
 *
 *  1. the stored `categoryId`, if it still exists **and** its type still matches
 *  2. `matchCategory(description, type, ...)`
 *  3. `findOtherCategory(type, ...)`
 *  4. `null`
 *
 * Step 1 re-checks membership and type rather than trusting the id, and that is not defensive
 * padding. `PUT /api/categories/[id]` lets a custom category's type be flipped underneath its
 * transactions, and `categoriesAreUsable` refuses a mismatched pair inside the write transaction.
 * Without the re-check a type flip elsewhere in the app turns a tap into a `CATEGORIES_NOT_OWNED`
 * rejection; with it, the tap logs somewhere sensible and says so.
 *
 * Returning `null` at step 4 is deliberate and must stay. Falling back to `categories[0]` is
 * exactly the bug `matchCategory` was changed to avoid: the list is ordered defaults-first then
 * alphabetically, so with the seeded data every unresolved expense landed under **Education**.
 * A caller that gets `null` should refuse the write and say why.
 *
 * @param categories the user's own list, already filtered to what they can use
 */
export const resolveTileCategory = (
  tile: TileCategoryInput,
  categories: BotCategory[]
): TileCategoryResolution | null => {
  if (tile.categoryId) {
    const stored = categories.find((c) => c.id === tile.categoryId && c.type === tile.type);
    if (stored) return { categoryId: stored.id, categoryName: stored.name, via: "tile" };
  }

  const matched = matchCategory(tile.description, tile.type, categories);
  if (matched) return { categoryId: matched.id, categoryName: matched.name, via: "matched" };

  const other = findOtherCategory(tile.type, categories);
  if (other) return { categoryId: other.id, categoryName: other.name, via: "other" };

  return null;
};

/**
 * Whether a tile is not filing where it was told to.
 *
 * The editor shows this before saving and the grid shows it on every read, so "your Lunch button
 * now files under Other Expense" is something the user is told rather than something they discover
 * in the category breakdown a month later.
 */
export const tileFallsBack = (resolution: TileCategoryResolution | null): boolean =>
  resolution === null || resolution.via !== "tile";

/**
 * The gap between two sparse `sortOrder` values.
 *
 * Sparse so a tile can be moved between two others by picking a number in between, rather than
 * renumbering every row. A full reorder still rewrites them all, which is what keeps the gaps from
 * closing up over time.
 */
export const SORT_ORDER_GAP = 10;

/** The `sortOrder` for a tile appended to an existing set. */
export const nextSortOrder = (existing: { sortOrder: number }[]): number =>
  existing.length === 0
    ? SORT_ORDER_GAP
    : Math.max(...existing.map((t) => t.sortOrder)) + SORT_ORDER_GAP;
