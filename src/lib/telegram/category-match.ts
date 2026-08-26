export interface BotCategory {
  id: string;
  name: string;
  type: string;
}

/** Keyword hints for the shorthand path, matched against the description. */
const HINTS: { pattern: RegExp; name: string }[] = [
  { pattern: /breakfast|lunch|dinner|coffee|food|snack|jollibee|mcdo|kfc|eat|restaurant/i, name: "food" },
  { pattern: /grab|angkas|taxi|bus|jeep|gas|fare|fuel|transport/i, name: "transport" },
  { pattern: /shopee|lazada|mall|clothes|shopping/i, name: "shopping" },
  { pattern: /bill|meralco|water|electric|internet|wifi/i, name: "utilities" },
  { pattern: /medicine|pharmacy|doctor|clinic|hospital|dental|dentist|checkup|meds/i, name: "health" },
];

/**
 * Pick a category for a shorthand entry, or admit there is no good answer.
 *
 * Returning `null` is the point. It used to fall back to `matchingCats[0]`, and the category list
 * is ordered defaults-first then alphabetically, so with the seeded data every unrecognised
 * expense was filed under **Education**: "100 medicine" included. That is silent corruption of
 * the category breakdown, which is the app's main analytic, and it is worse than not guessing.
 *
 * A caller that gets `null` has better options: hand the text to Gemini, which sees the whole
 * list, or fall back to an explicit "Other" category, which is at least honest.
 */
export const matchCategory = (
  description: string,
  type: "EXPENSE" | "INCOME",
  categories: BotCategory[]
): BotCategory | null => {
  const ofType = categories.filter((c) => c.type === type);
  const desc = description.toLowerCase();
  const named = (needle: string) => ofType.find((c) => c.name.toLowerCase().includes(needle));

  // The description naming a category outright is the strongest signal.
  const byName = ofType.find((c) => desc.includes(c.name.toLowerCase()));
  if (byName) return byName;

  if (type === "INCOME") return named("income") ?? named("salary") ?? null;

  for (const hint of HINTS) {
    if (!hint.pattern.test(desc)) continue;
    const found = named(hint.name);
    if (found) return found;
  }

  return null;
};

/**
 * The user's explicit "no idea" bucket, when they have one.
 *
 * Used only where nothing better is available, so an unmatched entry lands somewhere the user
 * would recognise as unsorted rather than inside a real category it does not belong to.
 */
export const findOtherCategory = (
  type: "EXPENSE" | "INCOME",
  categories: BotCategory[]
): BotCategory | null =>
  categories.find((c) => c.type === type && c.name.toLowerCase().startsWith("other")) ?? null;
