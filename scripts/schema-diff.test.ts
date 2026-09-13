import { describe, expect, it } from "vitest";
import { ACCEPTED_DIFF_STATEMENTS, diffStatements, driftingStatements } from "./schema-diff";

/** The one statement `migrate diff` reports on a clean checkout, verified against the real database. */
const ACCEPTED_INDEX =
  'CREATE UNIQUE INDEX "labels_name_user_id_key" ON "labels"("name", "user_id");';

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
    expect(driftingStatements(`-- CreateIndex\n${ACCEPTED_INDEX}`)).toEqual([]);
  });

  it("does NOT accept a DROP of that same index", () => {
    // The reason the allowlist matches whole statements rather than substrings. A rule keyed on
    // "mentions labels_name_user_id_key" would swallow this, and losing that index means duplicate
    // label names stop being refused case-insensitively.
    const drop = 'DROP INDEX "labels_name_user_id_key";';
    expect(driftingStatements(drop)).toEqual([drop]);
  });

  it("reports a dropped table, which is the #306 case", () => {
    // #304 removed the LabelCategory model while its table was deliberately still in place. Every
    // migration name matched, so the name check said OK -- and the next unrelated `migrate dev`
    // would have folded this DROP into itself.
    const script = ["-- DropTable", 'DROP TABLE "label_categories";'].join("\n");
    expect(driftingStatements(script)).toEqual(['DROP TABLE "label_categories";']);
  });

  it("reports real drift alongside the accepted index", () => {
    // The accepted statement must not mask anything reported with it.
    const script = `-- CreateIndex\n${ACCEPTED_INDEX}\n-- DropTable\nDROP TABLE "label_categories";`;
    expect(driftingStatements(script)).toEqual(['DROP TABLE "label_categories";']);
  });

  it("keeps the allowlist to one entry", () => {
    // Growing it is how a real schema change gets waved through. Adding one should be a deliberate
    // act that updates this test and says why.
    expect([...ACCEPTED_DIFF_STATEMENTS]).toEqual([ACCEPTED_INDEX]);
  });
});
