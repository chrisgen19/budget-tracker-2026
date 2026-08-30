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
 * from a dev machine, and the one category row they inserted carried an enum value the deployed
 * Prisma client did not know. Every `category.findMany()` without a `type` filter then failed while
 * *deserialising its own result* -- GET /api/categories, the MCP `get_category_list` tool, and so
 * every Telegram bot message -- across four green deploys that each reported nothing wrong.
 *
 * Runs in `pnpm build` *after* `prisma migrate deploy`, never before: the deploy that carries a
 * revert has to be allowed to apply it first, and by the time this runs the history should already
 * agree with the folder.
 *
 * Usage:
 *   pnpm exec tsx scripts/check-migration-drift.ts
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "./database-url";
import { isMissingTableError } from "./prisma-errors";

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
    console.log(
      `[check-migration-drift] OK — ${applied.length} applied migration(s), all present in prisma/migrations`
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
