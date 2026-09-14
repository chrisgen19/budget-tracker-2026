import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES_COLUMNS, CATEGORIES_TABLE } from "@/lib/transaction-writes";

/**
 * `categoriesAreUsableForWrite` issues a locking `SELECT ... FOR KEY SHARE` as raw SQL, because
 * Prisma has no way to express a row lock. Raw SQL bypasses Prisma's field mapping, so the
 * physical names are restated in application code -- the same cost `label-writes.schema.test.ts`
 * exists to cover, and the same guard.
 *
 * A rename in `schema.prisma` would leave `pnpm type-check` green and fail at runtime, and the
 * failure mode here is the quiet one: the query returns no rows, every category reads as unusable,
 * and every create is refused with a message about ownership that has nothing to do with the cause.
 *
 * Both ends are checked. The constants matching the schema says nothing about the query, since the
 * query does not read them -- rename a column in the schema *and* the constant, and a test that
 * stopped there would go green over SQL that is now wrong.
 */
const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

const schema = read("prisma", "schema.prisma");

/** The locking statement itself, not the module: the prose around it names these freely. */
const lockStatement = (() => {
  const source = read("src", "lib", "transaction-writes.ts");
  const match = source.match(/SELECT id, type[\s\S]*?FOR KEY SHARE/);
  if (!match) throw new Error("no locking SELECT found in src/lib/transaction-writes.ts");
  return match[0];
})();

const modelBody = (name: string): string => {
  const match = schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`model ${name} not found in prisma/schema.prisma`);
  return match[1];
};

describe("categories physical names", () => {
  it("matches the table the locking read targets", () => {
    expect(modelBody("Category")).toContain(`@@map("${CATEGORIES_TABLE}")`);
    expect(lockStatement).toContain(`FROM ${CATEGORIES_TABLE}`);
  });

  it("matches the owner column it filters on", () => {
    expect(modelBody("Category")).toContain(`@map("${CATEGORIES_COLUMNS.userId}")`);
    expect(lockStatement).toContain(CATEGORIES_COLUMNS.userId);
  });

  /**
   * The lock strength is the whole point and is easy to weaken by accident. `FOR SHARE` would also
   * block the type flip but conflicts with other writers' `FOR KEY SHARE`, serialising every
   * concurrent create into one category; a bare `SELECT` would take no lock at all and silently
   * restore the race this closes, with every test still green.
   */
  it("takes a shared key lock, not a stronger or weaker one", () => {
    expect(lockStatement).toMatch(/FOR KEY SHARE\s*$/);
    expect(lockStatement).not.toContain("FOR UPDATE");
  });

  /**
   * Deterministic order across a multi-category batch. Without it two batches naming an
   * overlapping set in different orders each hold what the other waits for, which is the deadlock
   * `updateTransactions` orders its own row locks to avoid.
   */
  it("locks in a deterministic order", () => {
    expect(lockStatement).toMatch(/ORDER BY id\s+FOR KEY SHARE/);
  });
});
