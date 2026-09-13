/**
 * Fail the build when the database holds a migration this repo does not have.
 *
 * `prisma migrate deploy` compares the folder to the database in one direction only. Asked to
 * deploy 33 local migrations against a database holding 35 applied ones it printed
 * "No pending migrations to apply." and exited 0; `prisma migrate status` printed "Database schema
 * is up to date!" and also exited 0. Neither has a word to say about a migration that reached the
 * database from somewhere other than this repo.
 *
 * That is not a hypothetical gap. Two migrations from the closed PR #187 were applied to production
 * by a Vercel preview build (see issue #192; the migration file's own comments still say "a dev
 * machine", which was the wrong conclusion), and the one category row they inserted carried an enum
 * value the deployed Prisma client did not know. Every `category.findMany()` without a `type`
 * filter then failed while *deserialising its own result* -- GET /api/categories, the MCP
 * `get_category_list` tool, and so every Telegram bot message -- across four green deploys that
 * each reported nothing wrong.
 *
 * Runs in `pnpm build:deploy` *after* `prisma migrate deploy`, never before: the deploy that
 * carries a revert has to be allowed to apply it first, and by the time this runs the history
 * should already agree with the folder.
 *
 * That ordering has a known cost, and it was weighed rather than missed. If a database is drifted
 * *and* the revision being deployed carries its own pending migration, `migrate deploy` applies
 * that migration before this check aborts the build -- so the schema moves forward while the old
 * container keeps serving. The narrower fix, checking first with the known-bad migrations
 * allow-listed by name, trades a temporary hardcoded list for it and has to be remembered and
 * removed later. It is also not the whole exposure: `pnpm build:deploy` runs `migrate deploy` at
 * *image build* time, so a type error or a failing lint already leaves a migrated database behind
 * an un-deployed image. That is a property of building and migrating in one step, and it is still
 * true after #192 -- what #192 changed is *who* can do it. The command now lives behind a script
 * name only `nixpacks.toml` calls, so a builder that runs `pnpm build` by convention no longer
 * migrates anything.
 *
 * Since #306 this checks two different things, and they catch opposite failures:
 *
 *   1. Migration NAMES -- the #192 direction. Something applied a migration this repo does not have.
 *   2. Schema versus DATABASE -- every name matching while `schema.prisma` and the database describe
 *      different tables. #304 removed the `LabelCategory` model while its table was deliberately
 *      still in place; every name matched, this script said OK, and the next `prisma migrate dev`
 *      for an unrelated change would have folded `DROP TABLE "label_categories"` into itself.
 *
 * Neither subsumes the other. A name check cannot see (2) because it never looks at a table, and a
 * schema diff cannot see (1) because a migration applied from elsewhere usually leaves the schema
 * agreeing perfectly.
 *
 * Usage:
 *   pnpm exec tsx scripts/check-migration-drift.ts
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./database-url";
import { isMissingTableError } from "./prisma-errors";
import { CASE_INSENSITIVE_LABEL_INDEX, driftingStatements } from "./schema-diff";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  console.error("[check-migration-drift] DATABASE_URL is not set");
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

/** Migration names this repo can produce: one directory each, `migration_lock.toml` aside. */
const localMigrationNames = (): Set<string> =>
  new Set(
    readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );

/**
 * Names recorded in `_prisma_migrations`, or `null` when the table does not exist.
 *
 * A first-ever build against an empty database reaches this before anything creates the table, and
 * a missing history is the one state that is genuinely not drift.
 *
 * Every other failure is rethrown. A `catch` that returned `null` for anything at all would report
 * an unreachable host or a refused login as "nothing to compare" and let the build through -- this
 * check would then be silent in exactly the conditions it exists to be loud in.
 */
const appliedMigrationNames = async (): Promise<string[] | null> => {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE rolled_back_at IS NULL
      ORDER BY started_at
    `;
    return rows.map((row) => row.migration_name);
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
};

/**
 * Whether the case-insensitive uniqueness index on `labels` is actually present.
 *
 * The expression index shares its NAME with the plain index Prisma wants, so Prisma cannot see it
 * and proposes the same `CREATE UNIQUE INDEX` either way. Accepting that statement on its text
 * alone therefore certifies a database that has lost the constraint entirely -- verified: with the
 * index dropped, this check reported OK and exited 0 (#312).
 *
 * Checked on `indexdef` rather than merely on the name existing, because an index by that name with
 * a plain `(name, user_id)` definition is a different constraint: it stops `Groceries` duplicating
 * `Groceries`, and lets it duplicate `groceries`.
 */
const hasCaseInsensitiveLabelIndex = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef
    FROM pg_indexes
    WHERE tablename = 'labels' AND indexname = 'labels_name_user_id_key'
  `;
  return rows.some((row) => /lower\s*\(\s*name\s*\)/i.test(row.indexdef));
};

/**
 * Whether `schema.prisma` and the live database actually agree.
 *
 * The name check above compares migration *names*, which is the #192 direction: something applied a
 * migration this repo does not have. It is blind to the mirror case -- every name matching while the
 * schema and the database describe different tables.
 *
 * That is not hypothetical either. #304 removed the `LabelCategory` model while its table was still
 * deliberately in place, and every name still matched, so this script said OK. `prisma migrate dev`
 * diffs the schema against migration history rather than comparing names, so the next migration
 * anyone generated -- for a change with nothing to do with labels -- would have silently carried
 * `DROP TABLE "label_categories"`. See #306.
 *
 * Read-only: `--script` prints SQL and applies nothing.
 */
const schemaDiffStatements = (accepted: ReadonlySet<string>): string[] => {
  const prismaBin = join(process.cwd(), "node_modules", ".bin", "prisma");
  const schema = join("prisma", "schema.prisma");
  // Resolved directly rather than through `pnpm exec`, which need not be on PATH in a builder.
  const script = execFileSync(
    prismaBin,
    [
      "migrate",
      "diff",
      "--from-schema-datasource",
      schema,
      "--to-schema-datamodel",
      schema,
      "--script",
    ],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl } }
  );
  return driftingStatements(script, accepted);
};

/** Returns the process exit code rather than setting it, so the caller owns the one exit path. */
async function main(): Promise<number> {
  const applied = await appliedMigrationNames();
  if (applied === null) {
    console.log("[check-migration-drift] no _prisma_migrations table yet — nothing to compare");
    return 0;
  }

  const local = localMigrationNames();
  const unknown = applied.filter((name) => !local.has(name));

  if (unknown.length === 0) {
    // The label index is accepted only once the database is known to still have it. See
    // `hasCaseInsensitiveLabelIndex` -- unconditional acceptance passed a database that had lost it.
    const indexPresent = await hasCaseInsensitiveLabelIndex();
    if (!indexPresent) {
      console.error(
        "[check-migration-drift] the case-insensitive unique index on labels is missing.\n\n" +
          "`labels` should be uniquely indexed on LOWER(name), user_id (migration " +
          "20260405120000). Without it two labels differing only in case can both be created, and " +
          "nothing else enforces this -- schema.prisma's @@unique([name, userId]) is declared for " +
          "ORM awareness and is not the constraint.\n\n" +
          "Restore it:\n" +
          '  CREATE UNIQUE INDEX "labels_name_user_id_key" ON "labels" (LOWER("name"), "user_id");'
      );
      return 1;
    }

    const schemaDrift = schemaDiffStatements(new Set([CASE_INSENSITIVE_LABEL_INDEX]));
    if (schemaDrift.length > 0) {
      console.error(
        `[check-migration-drift] every migration name matches, but schema.prisma and the database ` +
          `disagree on ${schemaDrift.length} object(s):`
      );
      for (const statement of schemaDrift) console.error(`  ${statement}`);
      console.error(
        "\nThese are the statements Prisma would run to make the database match schema.prisma. " +
          "They are not applied here, and on a deploy they should not be: a schema that has moved " +
          "without a migration means the migration is missing, not that the database is wrong.\n" +
          "\nWrite the migration that reconciles them, or restore the model the schema dropped. " +
          "Ignoring this is how a DROP reaches the next unrelated migration: `prisma migrate dev` " +
          "diffs the schema against history, so it will fold these statements into whatever you " +
          "generate next, under a name that says nothing about them."
      );
      return 1;
    }

    console.log(
      `[check-migration-drift] OK — ${applied.length} applied migration(s), all present in prisma/migrations; schema.prisma agrees with the database`
    );
    return 0;
  }

  console.error(
    `[check-migration-drift] ${unknown.length} migration(s) are applied to this database but do not exist in prisma/migrations:`
  );
  for (const name of unknown) console.error(`  - ${name}`);
  console.error(
    "\nThe database has migrations this checkout does not. On a deployment that means something " +
      "applied them from outside the repository, and the schema no longer matches the code: restore " +
      "the migration files, or add one that reverts their effects and deletes their " +
      "_prisma_migrations rows.\n" +
      "\nLocally it usually means something duller -- the branch you migrated on is not the branch " +
      "you are building. Switch back to it, or reset the development database."
  );
  return 1;
}

/**
 * One exit path, and the disconnect is awaited inside it.
 *
 * `main().catch(...).finally(() => prisma.$disconnect())` leaves the promise `.finally` returns
 * unhandled, so a rejected disconnect -- a pooler that already dropped the socket at the end of a
 * long build -- crashes the build with an unhandled rejection and a Prisma stack, burying whatever
 * verdict this actually reached. `process.exitCode` had the mirror-image problem: it only applies
 * once the event loop drains, so a lingering client handle would hang the build instead of failing
 * it.
 */
const run = async () => {
  let code = 1;
  try {
    code = await main();
  } catch (error) {
    console.error("[check-migration-drift] failed:", error);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(code);
};

run();
