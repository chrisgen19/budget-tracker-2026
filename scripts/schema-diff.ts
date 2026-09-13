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
export interface IndexRow {
  name: string;
  isUnique: boolean;
  isValid: boolean;
  /** `pg_get_indexdef()` output, which carries the key list and any WHERE predicate. */
  indexdef: string;
}

/**
 * A uniqueness constraint the database enforces and `schema.prisma` cannot describe.
 *
 * Prisma has no syntax for an expression index or a partial index, so for these the DATABASE is the
 * authority and the schema carries at best an approximation. That has a consequence worth stating
 * plainly: `prisma migrate diff` cannot report them missing. The label index is invisible because it
 * shares a name with the plain index Prisma wants, so the diff reads identically whether or not it
 * exists; the categories index is invisible because Prisma has never heard of it, so dropping it
 * changes the diff not at all. Both were verified against a real database.
 *
 * Which is why they are listed here and checked directly. Anything in this list is, by definition,
 * something no schema diff will ever catch.
 */
export interface AuthoritativeIndex {
  table: string;
  name: string;
  /** Normalised key list, e.g. `lower(name), user_id`. */
  key: string;
  /** Normalised WHERE predicate without its wrapping parens, or null for a full index. */
  where: string | null;
  /** What stops being enforced without it — said in the failure, where it is actually read. */
  guards: string;
  /** SQL that restores it, so the failure is actionable without a hunt through migrations. */
  restore: string;
}

export const AUTHORITATIVE_INDEXES: readonly AuthoritativeIndex[] = [
  {
    table: "labels",
    name: "labels_name_user_id_key",
    key: "lower(name), user_id",
    where: null,
    guards:
      "duplicate label names differing only in case, per user (migration 20260405120000). " +
      "schema.prisma's @@unique([name, userId]) is declared for ORM awareness and is NOT the constraint",
    restore:
      'CREATE UNIQUE INDEX "labels_name_user_id_key" ON "labels" (LOWER("name"), "user_id");',
  },
  {
    table: "categories",
    name: "categories_default_name_type_key",
    key: "name, type",
    where: "user_id is null",
    guards:
      "duplicate DEFAULT categories (migration 20260828100000). @@unique([name, type, userId]) " +
      "does not constrain them: their user_id is NULL and Postgres treats NULLs as distinct, so " +
      "two concurrent seeds can each insert the same default",
    restore:
      'CREATE UNIQUE INDEX "categories_default_name_type_key" ON "categories" ("name", "type") WHERE "user_id" IS NULL;',
  },
];

/** Lower-cases and collapses whitespace, so formatting differences do not read as drift. */
const normalise = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Splits `pg_get_indexdef()` into its key list and predicate.
 *
 * The predicate is split off FIRST, then the key taken greedily up to the final paren. A lazy match
 * for the key would stop inside `lower(name)`, and a greedy one applied to the whole definition
 * would swallow a trailing `WHERE (...)`.
 */
export const parseIndexDef = (indexdef: string): { key: string; where: string | null } | null => {
  const [keyPart, ...predicate] = indexdef.trim().split(/\s+where\s+/i);
  const key = /using\s+btree\s*\((.+)\)\s*$/i.exec(keyPart.trim())?.[1];
  if (key === undefined) return null;
  // Trimmed AFTER the parens come off: `WHERE ( user_id IS NULL )` normalises to
  // `( user_id is null )`, and stripping the wrapper leaves the inner spaces behind.
  const where =
    predicate.length > 0
      ? normalise(normalise(predicate.join(" where ")).replace(/^\((.*)\)$/, "$1"))
      : null;
  return { key: normalise(key), where };
};

/**
 * Whether an index row really is the constraint `expected` describes.
 *
 * Each clause corresponds to a database shape an earlier version of this accepted:
 *
 * - `isUnique` -- `CREATE INDEX ... (LOWER(name), user_id)` enforces nothing. Verified: the check
 *   exited 0 against exactly that.
 * - `isValid` -- a failed `CREATE INDEX CONCURRENTLY` leaves one in the catalogue enforcing nothing.
 * - the key -- an index on `LOWER(name)` alone is unique across the table rather than per user, so
 *   two people could not both have a "Groceries". Wrong in the other direction, equally quiet.
 * - the predicate -- compared rather than merely rejected, because `categories_default_name_type_key`
 *   is partial BY DESIGN. A `WHERE` that differs narrows what is constrained without touching the key.
 */
export const matchesAuthoritativeIndex = (row: IndexRow, expected: AuthoritativeIndex): boolean => {
  if (row.name !== expected.name || !row.isUnique || !row.isValid) return false;
  const parsed = parseIndexDef(row.indexdef);
  return parsed !== null && parsed.key === expected.key && parsed.where === expected.where;
};
