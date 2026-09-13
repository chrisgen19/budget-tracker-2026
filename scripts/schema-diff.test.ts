// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CASE_INSENSITIVE_LABEL_INDEX,
  diffStatements,
  driftingStatements,
  isCaseInsensitiveLabelIndex,
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
 * Each of these was accepted by an earlier version of the predicate, which tested `indexdef` for the
 * substring `LOWER(name)`. Two were confirmed against a real database before the fix: the check
 * exited 0 with no uniqueness enforced at all.
 */
describe("isCaseInsensitiveLabelIndex", () => {
  const healthy = {
    isUnique: true,
    isValid: true,
    notPartial: true,
    indexdef:
      "CREATE UNIQUE INDEX labels_name_user_id_key ON public.labels USING btree (lower(name), user_id)",
  };

  it("accepts the real constraint", () => {
    expect(isCaseInsensitiveLabelIndex(healthy)).toBe(true);
  });

  it("rejects a non-unique index over the same expression", () => {
    // `CREATE INDEX ... (LOWER(name), user_id)` contains the substring and enforces nothing.
    expect(isCaseInsensitiveLabelIndex({ ...healthy, isUnique: false })).toBe(false);
  });

  it("rejects an index missing user_id", () => {
    // Unique across the whole table rather than per user: two people could not both have a
    // "Groceries". Wrong in the opposite direction, and just as quiet.
    expect(
      isCaseInsensitiveLabelIndex({
        ...healthy,
        indexdef:
          "CREATE UNIQUE INDEX labels_name_user_id_key ON public.labels USING btree (lower(name))",
      })
    ).toBe(false);
  });

  it("rejects the case-SENSITIVE index of the same name", () => {
    // The silent downgrade: stops `Groceries` duplicating `Groceries`, lets it duplicate `groceries`.
    expect(
      isCaseInsensitiveLabelIndex({
        ...healthy,
        indexdef:
          "CREATE UNIQUE INDEX labels_name_user_id_key ON public.labels USING btree (name, user_id)",
      })
    ).toBe(false);
  });

  it("rejects an invalid index", () => {
    // A failed CREATE INDEX CONCURRENTLY leaves one in the catalogue that enforces nothing.
    expect(isCaseInsensitiveLabelIndex({ ...healthy, isValid: false })).toBe(false);
  });

  it("rejects a partial index", () => {
    // A WHERE clause narrows what is constrained without touching the key.
    expect(isCaseInsensitiveLabelIndex({ ...healthy, notPartial: false })).toBe(false);
  });

  it("tolerates whitespace and case in the definition", () => {
    expect(
      isCaseInsensitiveLabelIndex({
        ...healthy,
        indexdef:
          "CREATE UNIQUE INDEX labels_name_user_id_key ON public.labels USING BTREE ( LOWER(name),   user_id )",
      })
    ).toBe(true);
  });
});
