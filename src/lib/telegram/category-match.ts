export interface BotCategory {
  id: string;
  name: string;
  type: string;
}

/**
 * Build a hint pattern that only matches whole words.
 *
 * Unbounded alternations quietly matched inside other words, and every one of those is a
 * transaction filed under the wrong category with nothing to show for it: "theater ticket"
 * matched `eat` and became Food & Dining, "business permit" matched `bus` and became
 * Transportation, "watermelon" matched `water` and became Utilities.
 *
 * The optional trailing `s` keeps the plurals the sloppy version caught by accident; inflections
 * that are not just a plural ("eating") are listed outright.
 */
const words = (...list: string[]) => new RegExp(`\\b(?:${list.join("|")})s?\\b`, "i");

/** Keyword hints for the shorthand path, matched against the description. */
const HINTS: { pattern: RegExp; name: string }[] = [
  {
    pattern: words(
      "breakfast", "lunch", "lunches", "dinner", "coffee", "food", "snack", "meal",
      "jollibee", "mcdo", "kfc", "eat", "eating", "ate", "restaurant", "merienda"
    ),
    name: "food",
  },
  {
    pattern: words("grab", "angkas", "taxi", "bus", "buses", "jeep", "gas", "fare", "fuel", "transport", "transportation"),
    name: "transport",
  },
  { pattern: words("shopee", "lazada", "mall", "clothes", "shopping"), name: "shopping" },
  { pattern: words("bill", "meralco", "water", "electric", "electricity", "internet", "wifi"), name: "utilities" },
  {
    pattern: words("medicine", "pharmacy", "doctor", "clinic", "hospital", "dental", "dentist", "checkup", "med"),
    name: "health",
  },
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
