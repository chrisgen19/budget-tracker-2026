/**
 * Parsing for `prisma migrate diff --script` output, split out so it can be tested.
 *
 * The check that uses it lives in `check-migration-drift.ts`; running the diff needs a database and
 * the Prisma binary, but deciding what its output *means* does not.
 */

/**
 * Statements the diff reports that are NOT drift.
 *
 * Exactly one today, and it needs to stay exactly one. `labels` is uniquely indexed on
 * `LOWER(name), user_id` (migration `20260405120000`) so duplicate label names are refused
 * case-insensitively. Prisma cannot express an expression index, so `schema.prisma` carries a plain
 * `@@unique([name, userId])` "for ORM awareness" with the database constraint as the authority --
 * which means `migrate diff` proposes creating the index Prisma thinks is missing, forever.
 *
 * Matched as a whole normalised statement, never as a substring. A rule loose enough to match
 * "anything mentioning labels_name_user_id_key" would also swallow a DROP of it, which is real drift.
 */
export const ACCEPTED_DIFF_STATEMENTS = new Set([
  'CREATE UNIQUE INDEX "labels_name_user_id_key" ON "labels"("name", "user_id");',
]);

/**
 * Collapses `migrate diff --script` output into comparable statements.
 *
 * Comments are dropped: Prisma emits `-- CreateIndex` headers that carry no schema meaning and
 * would otherwise have to be allow-listed alongside the statements they label. Whitespace is
 * flattened so a statement Prisma chooses to wrap across lines still compares equal to the same
 * statement written on one.
 */
export const diffStatements = (script: string): string[] =>
  script
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"))
    .join(" ")
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement};`);

/** The statements that represent genuine drift: everything the diff reported, minus the accepted. */
export const driftingStatements = (script: string): string[] =>
  diffStatements(script).filter((statement) => !ACCEPTED_DIFF_STATEMENTS.has(statement));
