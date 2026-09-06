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
 * Known limit: `--clean` drops only the objects the source dump recreates, so a
 * table that exists locally and not on the source survives the refresh while
 * `_prisma_migrations` is replaced by the source's. The result is an object no
 * migration record explains, and `prisma migrate dev` then fails with "already
 * exists". Dropping the schema outright would avoid that but takes the whole
 * schema with it if the restore then fails, so the trade is deliberate: if you
 * have local-only migrations, drop the schema by hand first.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isLocalDatabase, databaseHost } from "./db-host";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  const value = i >= 0 ? argv[i + 1] : undefined;
  // A missing value swallows the next flag: `--from --apply` would otherwise
  // hand "--apply" to the guards below, where it reads as a non-local host.
  return value && !value.startsWith("--") ? value : undefined;
};

const SOURCE = flag("from");
const DEST = process.env.DATABASE_URL;
const BACKUP_DIR = flag("backup-dir") ?? join(process.cwd(), ".mirror-backups");
const UNREACHABLE = "unreachable";

/**
 * Split the password out of a connection string.
 *
 * psql and pg_dump take the URL as argv, so a password in it is visible to
 * every process on the machine via `ps` for the whole of a multi-minute dump,
 * and lands in any shell history or transcript of the command. PGPASSWORD is
 * read from the environment instead, which `ps` does not show.
 */
const splitCredentials = (url: string): { safeUrl: string; env: Record<string, string> } => {
  try {
    const u = new URL(url);
    const password = u.password ? decodeURIComponent(u.password) : "";
    u.password = "";
    return { safeUrl: u.toString(), env: password ? { PGPASSWORD: password } : {} };
  } catch {
    return { safeUrl: url, env: {} };
  }
};

const runOn = (url: string, cmd: string, args: string[]): string => {
  const { safeUrl, env } = splitCredentials(url);
  return execFileSync(cmd, [safeUrl, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
};

/** One row of orientation per side, so the direction is visible before writing. */
const describe = (url: string): string => {
  try {
    return runOn(url, "psql", [
      "-tAc",
      "select count(*)||' transactions, newest '||coalesce(max(created_at)::date::text,'none') from transactions",
    ]).trim();
  } catch {
    return UNREACHABLE;
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
  // Named separately from "is local", because isLocalDatabase fails closed: an
  // unparseable source reads as "not local" and would sail through the check
  // below, then die inside pg_dump after a backup had already been taken.
  if (databaseHost(SOURCE) === null) {
    console.error(
      `Refusing to run: --from is not a connection string this can read a host from.\n` +
        `Pass a full URL, quoted.`,
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

  // Captured once, before anything is written. Comparing two fresh reads at the
  // end would call a good refresh a mismatch whenever one row lands on the
  // source in between, and -- worse -- would call two failed reads a match.
  const sourceBefore = describe(SOURCE);
  console.log(`source  ${databaseHost(SOURCE)}   ${sourceBefore}`);
  console.log(`dest    ${databaseHost(DEST)} (local)   ${describe(DEST)}`);

  if (sourceBefore === UNREACHABLE) {
    console.error("\nThe source is unreachable. Nothing to copy.");
    return 1;
  }
  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to replace the local database.");
    return 0;
  }

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(BACKUP_DIR, `local-${stamp}.sql`);
  const dump = join(BACKUP_DIR, `source-${stamp}.sql`);
  const undo = `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ${backup}`;

  try {
    console.log(`\nBacking up the local database to ${backup}`);
    // --clean --if-exists, like the source dump. Without it the backup only
    // CREATEs, so restoring it over a database the refresh has already
    // repopulated fails on every table -- and psql without ON_ERROR_STOP
    // scrolls those errors past and still exits 0, so the undo would look like
    // it worked and change nothing.
    runOn(DEST, "pg_dump", ["--no-owner", "--no-privileges", "--clean", "--if-exists", "-f", backup]);

    console.log("Dumping the source...");
    runOn(SOURCE, "pg_dump", [
      "--no-owner",
      "--no-privileges",
      "--clean",
      "--if-exists",
      "-f",
      dump,
    ]);

    console.log("Restoring into the local database...");
    runOn(DEST, "psql", ["-v", "ON_ERROR_STOP=1", "-q", "-f", dump]);
  } catch (error) {
    // The local tables may already be dropped at this point, so the recovery
    // command has to be printed here rather than at the end -- which is where
    // it used to live, past the throw that made it necessary.
    console.error(`\nRefresh failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(
      existsSync(backup)
        ? `\nThe local database may be partly replaced. Restore it with:\n  ${undo}`
        : `\nNothing was written -- the backup itself did not complete.`,
    );
    return 1;
  } finally {
    // A full dump of the source: password hashes, token hashes, every
    // transaction. It has no use once restored and should not accumulate.
    rmSync(dump, { force: true });
  }

  const after = describe(DEST);
  console.log(`\nsource  ${sourceBefore}   (read before the dump)`);
  console.log(`dest    ${after}`);

  const matched = after !== UNREACHABLE && after === sourceBefore;
  console.log(
    matched
      ? "\nMatch. The local database is now a copy of the source."
      : "\nThe two do not match. Check the output above before trusting a report built on this.",
  );
  console.log(`\nTo undo:\n  ${undo}`);
  return matched ? 0 : 1;
}

process.exit(main());
