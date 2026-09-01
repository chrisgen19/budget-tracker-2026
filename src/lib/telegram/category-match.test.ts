import { describe, expect, it } from "vitest";
import { findOtherCategory, matchCategory, type BotCategory } from "@/lib/telegram/category-match";

/** The seeded defaults, in the order `get_category_list` returns them: defaults first, then by
 *  name. "Education" being first is what made the old fallback so damaging. */
const CATEGORIES: BotCategory[] = [
  "Education",
  "Entertainment",
  "Food & Dining",
  "Healthcare",
  "Housing",
  "Other Expense",
  "Personal Care",
  "Shopping",
  "Transportation",
  "Utilities",
].map((name) => ({ id: name.toLowerCase(), name, type: "EXPENSE" }));

const INCOME: BotCategory[] = [
  { id: "salary", name: "Salary", type: "INCOME" },
  { id: "other-income", name: "Other Income", type: "INCOME" },
];

describe("matchCategory", () => {
  it("matches a description that names a category", () => {
    expect(matchCategory("shopping spree", "EXPENSE", CATEGORIES)?.name).toBe("Shopping");
  });

  it("matches by keyword", () => {
    expect(matchCategory("jollibee lunch", "EXPENSE", CATEGORIES)?.name).toBe("Food & Dining");
    expect(matchCategory("grab to work", "EXPENSE", CATEGORIES)?.name).toBe("Transportation");
    expect(matchCategory("meralco bill", "EXPENSE", CATEGORIES)?.name).toBe("Utilities");
  });

  // The modes people actually use here. Before these were listed, "250 jeepney" and
  // "80 uv express" matched nothing: they were filed under Other Expense with no Gemini key,
  // or cost a model call with one, for the two most ordinary fares in the country.
  it("matches Philippine transport modes", () => {
    for (const desc of [
      "jeepney fare",
      "jeepneys to work",
      "uv express to office",
      "fare home (uv + jeep)",
      "tnvs to the office",
      "grabcar home",
      "tricycle to the terminal",
      "mrt ticket",
      "lrt load",
      "commute home",
    ]) {
      expect(matchCategory(desc, "EXPENSE", CATEGORIES)?.name, desc).toBe("Transportation");
    }
  });

  // `uv` is only two letters, so the word boundary is the whole safety margin. Without it every
  // description containing those letters would be filed as a fare.
  it("does not match short transport keywords inside other words", () => {
    expect(matchCategory("louvre tickets", "EXPENSE", CATEGORIES)).toBeNull();
    expect(matchCategory("souvenir for mum", "EXPENSE", CATEGORIES)).toBeNull();
  });

  // The bug this covers: with no match the caller took `matchingCats[0]`, which is Education
  // with the seeded data, so "100 medicine" was recorded as an education expense. Silent
  // corruption of the category breakdown is worse than declining to guess.
  it("returns null rather than guessing when nothing matches", () => {
    expect(matchCategory("random thing", "EXPENSE", CATEGORIES)).toBeNull();
    expect(matchCategory("birthday gift for mum", "EXPENSE", CATEGORIES)).toBeNull();
  });

  it("never silently picks the alphabetically first category", () => {
    for (const desc of ["random thing", "widget", "misc stuff"]) {
      expect(matchCategory(desc, "EXPENSE", CATEGORIES)?.name).not.toBe("Education");
    }
  });

  // The bug this covers: the hint patterns were unbounded alternations, so they matched inside
  // other words. Seven of ten sample descriptions were misfiled, each one silently.
  it("does not match a keyword buried inside another word", () => {
    const cases: [string, string][] = [
      ["theater ticket", "eat"],
      ["business permit", "bus"],
      ["watermelon", "water"],
      ["great seats", "eat"],
      ["sweater", "eat"],
      ["small gift", "mall"],
      ["gasket repair", "gas"],
    ];
    for (const [desc] of cases) {
      expect(matchCategory(desc, "EXPENSE", CATEGORIES)).toBeNull();
    }
  });

  it("still matches the plurals and inflections the loose version caught", () => {
    expect(matchCategory("eating out", "EXPENSE", CATEGORIES)?.name).toBe("Food & Dining");
    expect(matchCategory("snacks", "EXPENSE", CATEGORIES)?.name).toBe("Food & Dining");
    expect(matchCategory("lunches", "EXPENSE", CATEGORIES)?.name).toBe("Food & Dining");
    expect(matchCategory("meds", "EXPENSE", CATEGORIES)?.name).toBe("Healthcare");
  });

  it("routes medicine to healthcare rather than education", () => {
    expect(matchCategory("medicine", "EXPENSE", CATEGORIES)?.name).toBe("Healthcare");
    expect(matchCategory("dentist checkup", "EXPENSE", CATEGORIES)?.name).toBe("Healthcare");
  });

  it("matches income by its usual names", () => {
    expect(matchCategory("monthly pay", "INCOME", INCOME)?.name).toBe("Other Income");
    expect(matchCategory("salary", "INCOME", INCOME)?.name).toBe("Salary");
  });

  it("only considers categories of the right type", () => {
    expect(matchCategory("salary", "EXPENSE", CATEGORIES)).toBeNull();
  });

  it("returns null when there are no categories at all", () => {
    expect(matchCategory("lunch", "EXPENSE", [])).toBeNull();
  });
});

describe("findOtherCategory", () => {
  it("finds the explicit unsorted bucket", () => {
    expect(findOtherCategory("EXPENSE", CATEGORIES)?.name).toBe("Other Expense");
    expect(findOtherCategory("INCOME", INCOME)?.name).toBe("Other Income");
  });

  it("returns null when the user has deleted it", () => {
    expect(findOtherCategory("EXPENSE", CATEGORIES.filter((c) => c.name !== "Other Expense"))).toBeNull();
  });

  it("does not cross types", () => {
    expect(findOtherCategory("INCOME", CATEGORIES)).toBeNull();
  });
});

/**
 * The matcher picks with `.find()`, so when two categories both satisfy a needle the list order
 * decides, and `get_category_list` orders defaults first (`getCategoryList ordering` in
 * budget-queries.test.ts pins that). A user's custom category is therefore never allowed to
 * shadow the seeded one it happens to resemble.
 *
 * This is the coupling to notice if that query is ever reworked: dropping `isDefault: "desc"` for
 * plain alphabetical ordering compiles, passes every other test, and silently reroutes the bot.
 */
describe("ordering decides which of two matching categories wins", () => {
  const DEFAULT_FIRST: BotCategory[] = [
    { id: "food-dining", name: "Food & Dining", type: "EXPENSE" },
    { id: "fast-food", name: "Fast Food", type: "EXPENSE" },
  ];

  it("prefers the seeded default over a custom category matching the same keyword", () => {
    expect(matchCategory("jollibee lunch", "EXPENSE", DEFAULT_FIRST)?.name).toBe("Food & Dining");
  });

  it("would pick the custom one if the list were ordered alphabetically instead", () => {
    // Not desired behaviour: this is the regression that dropping `isDefault: "desc"` would cause,
    // written down so the cost of that change is visible rather than inferred.
    const alphabetical = [...DEFAULT_FIRST].sort((a, b) => a.name.localeCompare(b.name));
    expect(alphabetical[0].name).toBe("Fast Food");
    expect(matchCategory("jollibee lunch", "EXPENSE", alphabetical)?.name).toBe("Fast Food");
  });

  it("prefers the seeded unsorted bucket over a custom category also starting with other", () => {
    const buckets: BotCategory[] = [
      { id: "other-expense", name: "Other Expense", type: "EXPENSE" },
      { id: "other-stuff", name: "Other Stuff", type: "EXPENSE" },
    ];
    expect(findOtherCategory("EXPENSE", buckets)?.name).toBe("Other Expense");
  });
});
