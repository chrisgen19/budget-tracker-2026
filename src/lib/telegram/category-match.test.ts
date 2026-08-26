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
