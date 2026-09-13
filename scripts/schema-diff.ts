/**
 * Parsing for `prisma migrate diff --script` output, split out so it can be tested.
 *
 * The check that uses it lives in `check-migration-drift.ts`; running the diff needs a database and
 * the Prisma binary, but deciding what its output *means* does not.
 */

/**
 * The one statement the diff always reports on a healthy database.
 *
 * `labels` is uniquely indexed on `LOWER(name), user_id` (migration `20260405120000`) so duplicate
 * label names are refused case-insensitively. Prisma cannot express an expression index, so
 * `schema.prisma` carries a plain `@@unique([name, userId])` "for ORM awareness" with the database
 * constraint as the authority -- and `migrate diff` proposes creating the index Prisma thinks is
 * missing, forever.
 *
 * **Accepting this unconditionally was a hole, and a bad one.** The expression index carries the
 * SAME NAME as the plain one Prisma wants, so Prisma cannot see it at all -- which means dropping
 * the expression index changes the diff not one character. Filtering the statement on its text
 * alone therefore passed a database that had lost the only constraint preventing duplicate
 * case-insensitive label names. Verified: with the index dropped, the check reported OK and exited
 * 0. Raised by Codex on #312.
 *
 * So the caller must confirm the expression index actually exists and pass the result in. That is
 * why this is a bare constant rather than a set the filter reaches for on its own.
 */
export const CASE_INSENSITIVE_LABEL_INDEX =
  'CREATE UNIQUE INDEX "labels_name_user_id_key" ON "labels"("name", "user_id");';

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

/**
 * The statements that represent genuine drift.
 *
 * `accepted` is passed in rather than read from a module constant, so that accepting the label
 * index stays a decision the caller has to justify against the live database. Matched as whole
 * normalised statements, never substrings: a rule loose enough to match "anything mentioning
 * labels_name_user_id_key" would also swallow a `DROP` of it.
 */
export const driftingStatements = (
  script: string,
  accepted: ReadonlySet<string> = new Set()
): string[] => diffStatements(script).filter((statement) => !accepted.has(statement));

/** The facts about an index that decide whether it is the constraint we need. */
export interface LabelIndexRow {
  isUnique: boolean;
  isValid: boolean;
  notPartial: boolean;
  /** `pg_get_indexdef()` output, e.g. `CREATE UNIQUE INDEX ... USING btree (lower(name), user_id)`. */
  indexdef: string;
}

/** The key list the constraint must have, normalised: lower-cased, single-spaced. */
const REQUIRED_LABEL_INDEX_KEY = "lower(name), user_id";

/**
 * Whether an index row really is the case-insensitive uniqueness constraint on `labels`.
 *
 * Every clause here failed a real database that this returned true for when it was a substring
 * test for `LOWER(name)`:
 *
 * - `isUnique` -- `CREATE INDEX ... (LOWER(name))` contains the substring and enforces nothing.
 *   Verified: the check exited 0 against exactly that.
 * - the full key -- an index on `LOWER(name)` ALONE is unique across the whole table rather than
 *   per user, so two people cannot both have a "Groceries". Wrong in the other direction, and
 *   equally invisible.
 * - `isValid` -- a `CREATE INDEX CONCURRENTLY` that failed leaves an invalid index behind. It
 *   appears in the catalogue and enforces nothing.
 * - `notPartial` -- a `WHERE` clause narrows what is constrained without changing the key.
 *
 * Structured facts rather than comparing the whole `indexdef` string, which varies by Postgres
 * version and schema qualification and would make this brittle where it needs to be exact.
 */
export const isCaseInsensitiveLabelIndex = (row: LabelIndexRow): boolean => {
  if (!row.isUnique || !row.isValid || !row.notPartial) return false;
  // The key list is the parenthesised tail, captured rather than split on "(" -- `lower(name)`
  // nests, so anything simpler truncates it.
  const key = /using\s+btree\s*\((.+)\)\s*$/i.exec(row.indexdef.trim())?.[1];
  return key?.toLowerCase().replace(/\s+/g, " ").trim() === REQUIRED_LABEL_INDEX_KEY;
};
