/**
 * Pure planning half of `merge-fare-spellings.ts`: which commute-fare descriptions are one
 * thing stored several ways, and which spelling each should become.
 *
 * Import-safe (no Prisma client at module scope) so it can be unit-tested without a database.
 */

/** A description is a fare when it names one of these modes as a whole word. */
export const FARE_PATTERN = /(^|[^a-z])(uv|jeep|mini ?bus)([^a-z]|$)/i;

/**
 * The key two spellings must share to be merged.
 *
 * Case, spacing and punctuation are dropped, as in `findFragmentation`, and so is the word "and",
 * so "UV and Jeep" meets "UV & Jeep". Word order is kept: "Jeep & UV" and "UV & Jeep" are
 * different trips (the order records the direction), not two spellings of one.
 */
export const fareKey = (description: string): string =>
  description
    .toLowerCase()
    .replace(/\band\b/g, " ")
    .replace(/[^a-z0-9]/g, "");

export type SpellingUse = {
  description: string;
  count: number;
  /** Newest row carrying this exact spelling; breaks a tie in `count`. */
  lastUsed: Date;
};

export type FareMerge = {
  canonical: string;
  /** Every other spelling in the group, each rewritten to `canonical`. */
  variants: SpellingUse[];
};

/**
 * Groups one user's fare spellings and picks a canonical for each group with more than one.
 *
 * The canonical is the spelling used most, then the one used most recently. That is the
 * spelling the user is already typing, so the merge moves the outliers toward their habit
 * rather than imposing a new one. A canonical with edge whitespace is trimmed, which makes
 * even a group of one spelling a merge when that spelling is untrimmed.
 */
export const planFareMerges = (uses: SpellingUse[]): FareMerge[] => {
  const groups = new Map<string, SpellingUse[]>();
  for (const use of uses) {
    if (!FARE_PATTERN.test(use.description)) continue;
    const key = fareKey(use.description);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), use]);
  }

  const merges: FareMerge[] = [];
  for (const group of groups.values()) {
    const ranked = [...group].sort(
      (a, b) => b.count - a.count || b.lastUsed.getTime() - a.lastUsed.getTime(),
    );
    const canonical = ranked[0].description.trim().replace(/\s+/g, " ");
    const variants = ranked.filter((u) => u.description !== canonical);
    if (variants.length > 0) merges.push({ canonical, variants });
  }
  return merges.sort(
    (a, b) =>
      b.variants.reduce((n, v) => n + v.count, 0) - a.variants.reduce((n, v) => n + v.count, 0),
  );
};
