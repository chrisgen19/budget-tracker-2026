import { describe, expect, it } from "vitest";
import { TransactionType } from "@prisma/client";
import { DEFAULT_CATEGORIES, findOrphanedDefaults } from "@/lib/default-categories";

const cat = (name: string, type: TransactionType = TransactionType.EXPENSE) => ({ name, type });

describe("findOrphanedDefaults", () => {
  /**
   * The bug this covers: `Education` was replaced by `Fun` in the seeded list, but dropping a
   * name does not delete the row it already created. On a database seeded by the earlier
   * revision both survive as defaults, and since `DELETE /api/categories/[id]` filters on
   * `isDefault: false`, the leftover cannot be removed through the app.
   */
  it("reports a default that is no longer seeded", () => {
    const stored = [cat("Fun"), cat("Education"), cat("Groceries")];

    expect(findOrphanedDefaults(stored).map((c) => c.name)).toEqual(["Education"]);
  });

  it("reports nothing when every stored default is still seeded", () => {
    const stored = DEFAULT_CATEGORIES.map((c) => cat(c.name, c.type));

    expect(findOrphanedDefaults(stored)).toEqual([]);
  });

  it("matches on type as well as name, so the two Other categories stay distinct", () => {
    // "Other Expense" and "Other Income" differ only by type; a name-only check would
    // let an income leftover hide behind the expense entry.
    const stored = [cat("Other Expense", TransactionType.INCOME)];

    expect(findOrphanedDefaults(stored).map((c) => c.name)).toEqual(["Other Expense"]);
  });

  it("treats an empty database as having no orphans", () => {
    expect(findOrphanedDefaults([])).toEqual([]);
  });
});
