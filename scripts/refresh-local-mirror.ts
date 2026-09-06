/**
 * Replace the local development database with a copy of another one.
 *
 * `/finance-assess` reads the local database for its pattern work, and a mirror
 * goes stale the moment the app is used again -- which showed up as a report
 * confidently quoting a balance that was 22,000 out of date. This is the one
 * command that fixes that, so refreshing is a deliberate step rather than a
 * sequence anyone has to remember.
 *
 *   pnpm exec tsx --env-file=.env scripts/refresh-local-mirror.ts --from "<source url>"
 *   pnpm exec tsx --env-file=.env scripts/refresh-local-mirror.ts --from "<source url>" --apply
 *
 * Dry run unless `--apply` is passed: it reports what each side holds and stops.
 *
 * The destination is always `DATABASE_URL` and **must be local**, checked with
 * the same `isLocalDatabase` that guards `db:migrate` and `db:push`. This
 * script drops and recreates every table it restores, so pointing it the wrong
 * way round would destroy the source it was meant to copy -- the one mistake
 * here that cannot be undone from a backup taken afterwards.
 *
 * The local database is dumped to a timestamped file before anything is
 * dropped, so a refresh is reversible:
 *
 *   psql "$DATABASE_URL" -f <the backup this prints>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isLocalDatabase, databaseHost } from "./db-host";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const SOURCE = flag("from");
const DEST = process.env.DATABASE_URL;
const BACKUP_DIR = flag("backup-dir") ?? join(process.cwd(), ".mirror-backups");

const run = (cmd: string, args: string[]): string =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** One row of orientation per side, so the direction is visible before writing. */
const describe = (url: string): string => {
  try {
    const out = run("psql", [
      url,
      "-tAc",
      "select count(*)||' transactions, newest '||coalesce(max(created_at)::date::text,'none') from transactions",
    ]);
    return out.trim();
  } catch {
    return "unreachable";
  }
};

function main(): number {
  if (!SOURCE) {
    console.error('Usage: --from "<source connection string>" [--apply]');
    console.error("The destination is DATABASE_URL and must be a local database.");
    return 1;
  }
  if (!DEST) {
    console.error("DATABASE_URL is not set -- nothing to refresh.");
    return 1;
  }

  // The guard that matters. Everything below drops and recreates tables, so a
  // reversed --from would destroy the database it was copying.
  if (!isLocalDatabase(DEST)) {
    console.error(
      `Refusing to run: DATABASE_URL points at ${databaseHost(DEST) ?? "an unknown host"}, ` +
        `which is not local.\nThis script overwrites its destination. It only ever writes to a ` +
        `database on this machine.`,
    );
    return 1;
  }
  if (isLocalDatabase(SOURCE)) {
    console.error(
      "Refusing to run: --from is also a local database. That is either a typo or a no-op, " +
        "and getting the direction wrong here is not recoverable.",
    );
    return 1;
  }

  console.log(`source  ${databaseHost(SOURCE)}   ${describe(SOURCE)}`);
  console.log(`dest    ${databaseHost(DEST)} (local)   ${describe(DEST)}`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to replace the local database.");
    return 0;
  }

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(BACKUP_DIR, `local-${stamp}.sql`);

  console.log(`\nBacking up the local database to ${backup}`);
  run("pg_dump", [DEST, "--no-owner", "--no-privileges", "-f", backup]);

  // --clean --if-exists rather than dropping the schema outright: it drops each
  // object the dump recreates, which is the same end state without a statement
  // that would take the whole schema with it if the restore then failed.
  const dump = join(BACKUP_DIR, `source-${stamp}.sql`);
  console.log("Dumping the source...");
  run("pg_dump", [SOURCE, "--no-owner", "--no-privileges", "--clean", "--if-exists", "-f", dump]);

  console.log("Restoring into the local database...");
  run("psql", [DEST, "-v", "ON_ERROR_STOP=1", "-q", "-f", dump]);

  const after = describe(DEST);
  const src = describe(SOURCE);
  console.log(`\nsource  ${src}`);
  console.log(`dest    ${after}`);
  console.log(
    after === src
      ? "\nMatch. The local database is now a copy of the source."
      : "\nThe two do not match. Check the output above before trusting a report built on this.",
  );
  console.log(`\nTo undo:\n  psql "$DATABASE_URL" -f ${backup}`);
  return after === src ? 0 : 1;
}

process.exit(main());
