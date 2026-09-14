// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AUTHORITATIVE_INDEXES,
  CASE_INSENSITIVE_LABEL_INDEX,
  diffStatements,
  driftingStatements,
  matchesAuthoritativeIndex,
  parseIndexDef,
} from "./schema-diff";

/** The one statement `migrate diff` reports on a clean checkout, verified against the real database. */
const ACCEPTED_INDEX = CASE_INSENSITIVE_LABEL_INDEX;

/** What the caller passes once it has confirmed the expression index is really there. */
const WHEN_INDEX_PRESENT = new Set([CASE_INSENSITIVE_LABEL_INDEX]);

describe("diffStatements", () => {
  it("drops Prisma's comment headers", () => {
    // `-- CreateIndex` carries no schema meaning. Keeping it would force every accepted statement to
    // be allow-listed together with the comment that happens to precede it.
    expect(diffStatements(`-- CreateIndex\n${ACCEPTED_INDEX}`)).toEqual([ACCEPTED_INDEX]);
  });

  it("normalises a statement Prisma wrapped across lines", () => {
    const wrapped = 'ALTER TABLE "labels"\n  DROP CONSTRAINT\n  "labels_user_id_fkey";';
    expect(diffStatements(wrapped)).toEqual([
      'ALTER TABLE "labels" DROP CONSTRAINT "labels_user_id_fkey";',
    ]);
  });

  it("returns nothing for an empty diff", () => {
    // The ordinary case on a healthy deploy: no output at all.
    expect(diffStatements("")).toEqual([]);
    expect(diffStatements("\n\n  \n")).toEqual([]);
  });

  it("splits several statements", () => {
    const script = [
      "-- DropForeignKey",
      'ALTER TABLE "label_categories" DROP CONSTRAINT "label_categories_label_id_fkey";',
      "",
      "-- DropTable",
      'DROP TABLE "label_categories";',
    ].join("\n");

    expect(diffStatements(script)).toEqual([
      'ALTER TABLE "label_categories" DROP CONSTRAINT "label_categories_label_id_fkey";',
      'DROP TABLE "label_categories";',
    ]);
  });
});

describe("driftingStatements", () => {
  it("accepts the LOWER(name) index Prisma cannot express", () => {
    // schema.prisma declares @@unique([name, userId]) while the database has a LOWER(name) index
    // (migration 20260405120000). The diff proposes creating the one Prisma thinks is missing on
    // every run, forever, and that is not drift.
    expect(driftingStatements(`-- CreateIndex\n${ACCEPTED_INDEX}`, WHEN_INDEX_PRESENT)).toEqual([]);
  });

  it("does NOT accept a DROP of that same index", () => {
    // The reason the allowlist matches whole statements rather than substrings. A rule keyed on
    // "mentions labels_name_user_id_key" would swallow this, and losing that index means duplicate
    // label names stop being refused case-insensitively.
    const drop = 'DROP INDEX "labels_name_user_id_key";';
    expect(driftingStatements(drop, WHEN_INDEX_PRESENT)).toEqual([drop]);
  });

  it("reports a dropped table, which is the #306 case", () => {
    // #304 removed the LabelCategory model while its table was deliberately still in place. Every
    // migration name matched, so the name check said OK -- and the next unrelated `migrate dev`
    // would have folded this DROP into itself.
    const script = ["-- DropTable", 'DROP TABLE "label_categories";'].join("\n");
    expect(driftingStatements(script, WHEN_INDEX_PRESENT)).toEqual(['DROP TABLE "label_categories";']);
  });

  it("reports real drift alongside the accepted index", () => {
    // The accepted statement must not mask anything reported with it.
    const script = `-- CreateIndex\n${ACCEPTED_INDEX}\n-- DropTable\nDROP TABLE "label_categories";`;
    expect(driftingStatements(script, WHEN_INDEX_PRESENT)).toEqual(['DROP TABLE "label_categories";']);
  });

  it("accepts nothing at all by default", () => {
    // The default matters more than it looks. Acceptance is the caller's decision, made against the
    // live database, and a filter that quietly accepted the label index on its own is exactly the
    // hole this was changed to close: the expression index shares a NAME with the plain one Prisma
    // wants, so Prisma cannot see it and emits the same statement whether or not it exists.
    expect(driftingStatements(`-- CreateIndex\n${ACCEPTED_INDEX}`)).toEqual([ACCEPTED_INDEX]);
  });

  it("reports the label index when the caller has not confirmed it", () => {
    // What the script now does when `hasCaseInsensitiveLabelIndex()` comes back false.
    expect(driftingStatements(ACCEPTED_INDEX, new Set())).toEqual([ACCEPTED_INDEX]);
  });
});

/**
 * Each shape below was accepted by an earlier version of this check. Two were confirmed against a
 * real database before the fix: it exited 0 with no uniqueness enforced at all.
 */
describe("matchesAuthoritativeIndex", () => {
  const LABELS = AUTHORITATIVE_INDEXES.find((i) => i.table === "labels")!;
  const CATEGORIES = AUTHORITATIVE_INDEXES.find((i) => i.table === "categories")!;

  const healthyLabels = {
    name: "labels_name_user_id_key",
    isUnique: true,
    isValid: true,
    indexdef:
      "CREATE UNIQUE INDEX labels_name_user_id_key ON public.labels USING btree (lower(name), user_id)",
  };
  const healthyCategories = {
    name: "categories_default_name_type_key",
    isUnique: true,
    isValid: true,
    indexdef:
      "CREATE UNIQUE INDEX categories_default_name_type_key ON public.categories USING btree (name, type) WHERE (user_id IS NULL)",
  };

  it("accepts both real constraints", () => {
    expect(matchesAuthoritativeIndex(healthyLabels, LABELS)).toBe(true);
    expect(matchesAuthoritativeIndex(healthyCategories, CATEGORIES)).toBe(true);
  });

  it("rejects a non-unique index over the right expression", () => {
    // `CREATE INDEX ...` contains everything the old substring test looked for and enforces nothing.
    expect(matchesAuthoritativeIndex({ ...healthyLabels, isUnique: false }, LABELS)).toBe(false);
  });

  it("rejects an invalid index", () => {
    // A failed CREATE INDEX CONCURRENTLY leaves one in the catalogue that enforces nothing.
    expect(matchesAuthoritativeIndex({ ...healthyLabels, isValid: false }, LABELS)).toBe(false);
  });

  it("rejects an index missing user_id", () => {
    // Unique across the table rather than per user: two people could not both have a "Groceries".
    expect(
      matchesAuthoritativeIndex(
        {
          ...healthyLabels,
          indexdef:
            "CREATE UNIQUE INDEX labels_name_user_id_key ON public.labels USING btree (lower(name))",
        },
        LABELS
      )
    ).toBe(false);
  });

  it("rejects the case-SENSITIVE index of the same name", () => {
    // The silent downgrade: stops `Groceries` duplicating `Groceries`, lets it duplicate `groceries`.
    expect(
      matchesAuthoritativeIndex(
        {
          ...healthyLabels,
          indexdef:
            "CREATE UNIQUE INDEX labels_name_user_id_key ON public.labels USING btree (name, user_id)",
        },
        LABELS
      )
    ).toBe(false);
  });

  it("rejects a labels index that has become partial", () => {
    // A WHERE narrows what is constrained without touching the key.
    expect(
      matchesAuthoritativeIndex(
        { ...healthyLabels, indexdef: `${healthyLabels.indexdef} WHERE (user_id IS NOT NULL)` },
        LABELS
      )
    ).toBe(false);
  });

  it("rejects a categories index that has LOST its predicate", () => {
    // The mirror case, and the reason predicates are compared rather than rejected outright:
    // categories_default_name_type_key is partial by design. Without `WHERE user_id IS NULL` it
    // constrains every category rather than only the defaults.
    expect(
      matchesAuthoritativeIndex(
        {
          ...healthyCategories,
          indexdef:
            "CREATE UNIQUE INDEX categories_default_name_type_key ON public.categories USING btree (name, type)",
        },
        CATEGORIES
      )
    ).toBe(false);
  });

  it("rejects an index of the wrong name", () => {
    expect(matchesAuthoritativeIndex({ ...healthyLabels, name: "something_else" }, LABELS)).toBe(
      false
    );
  });

  it("tolerates whitespace and case", () => {
    expect(
      matchesAuthoritativeIndex(
        {
          ...healthyCategories,
          indexdef:
            "CREATE UNIQUE INDEX categories_default_name_type_key ON public.categories USING BTREE ( name,  type ) WHERE ( user_id IS NULL )",
        },
        CATEGORIES
      )
    ).toBe(true);
  });
});

describe("parseIndexDef", () => {
  it("keeps a nested expression in the key", () => {
    // A lazy match would stop inside `lower(name)`.
    expect(
      parseIndexDef("CREATE UNIQUE INDEX x ON t USING btree (lower(name), user_id)")
    ).toEqual({ key: "lower(name), user_id", where: null });
  });

  it("splits the predicate off before reading the key", () => {
    // A greedy match over the whole definition would swallow the WHERE into the key.
    expect(
      parseIndexDef("CREATE UNIQUE INDEX x ON t USING btree (name, type) WHERE (user_id IS NULL)")
    ).toEqual({ key: "name, type", where: "user_id is null" });
  });

  it("returns null for something that is not a btree definition", () => {
    expect(parseIndexDef("not an index definition")).toBeNull();
  });
});
