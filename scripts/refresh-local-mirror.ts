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
import { mkdirSync, existsSync, rmSync, chmodSync } from "node:fs";
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

/**
 * Both sides' orientation, including the settings an assessment depends on.
 *
 * Row counts alone are not a freshness signal: a settings change moves no rows.
 * On 6 Sep both databases held 829 identical transactions while the mirror had
 * `is_variable = 0` against the source's `2`, so a report built on it would have
 * called two metered bills fixed and quoted the wrong forecast for each. The
 * fingerprint covers the bill and account fields the assessment reads, so a
 * divergence in any of them shows up here rather than in the report.
 */
const CONFIG_FINGERPRINT = `
  select md5(
    coalesce((select string_agg(id||':'||amount||':'||is_variable||':'||is_active||':'||next_due_date, ','
                                order by id) from scheduled_transactions), '') ||
    coalesce((select string_agg(id||':'||currency||':'||timezone_offset, ',' order by id) from users), '')
  )`;

type Snapshot = { rows: string; config: string };

const describe = (url: string): Snapshot => {
  try {
    const rows = runOn(url, "psql", [
      "-tAc",
      "select count(*)||' transactions, newest '||coalesce(max(created_at)::date::text,'none') from transactions",
    ]).trim();
    const config = runOn(url, "psql", ["-tAc", CONFIG_FINGERPRINT]).trim();
    return { rows, config };
  } catch {
    return { rows: UNREACHABLE, config: UNREACHABLE };
  }
};

const line = (s: Snapshot): string => `${s.rows}  ·  settings ${s.config.slice(0, 8)}`;

/**
 * Refuse a source that permits an unencrypted connection.
 *
 * libpq's `disable`, `allow` and `prefer` will all send credentials and the
 * whole database in cleartext if the server does not insist otherwise, and this
 * copies an entire production database over that connection. `require` and
 * above are accepted: `require` does not authenticate the server, which is a
 * real weakness, but demanding `verify-full` here would refuse the connection
 * string this deployment actually uses and needs a CA bundle to satisfy.
 */
const sslProblem = (url: string): string | null => {
  let mode: string | null;
  try {
    mode = new URL(url).searchParams.get("sslmode");
  } catch {
    return null;
  }
  if (mode === null) return "no sslmode= is set, so libpq may connect in cleartext";
  if (["disable", "allow", "prefer"].includes(mode)) {
    return `sslmode=${mode} permits an unencrypted connection`;
  }
  return null;
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
  const ssl = sslProblem(SOURCE);
  if (ssl) {
    console.error(
      `Refusing to run: ${ssl}.\nThis copies an entire database across that connection. ` +
        `Add sslmode=require (or stronger) to the source URL.`,
    );
    return 1;
  }

  // Captured once, before anything is written. Comparing two fresh reads at the
  // end would call a good refresh a mismatch whenever one row lands on the
  // source in between, and -- worse -- would call two failed reads a match.
  const sourceBefore = describe(SOURCE);
  const destBefore = describe(DEST);
  console.log(`source  ${databaseHost(SOURCE)}   ${line(sourceBefore)}`);
  console.log(`dest    ${databaseHost(DEST)} (local)   ${line(destBefore)}`);
  if (
    sourceBefore.rows !== UNREACHABLE &&
    destBefore.rows !== UNREACHABLE &&
    sourceBefore.rows === destBefore.rows &&
    sourceBefore.config !== destBefore.config
  ) {
    console.log(
      `\nSame transactions, different settings -- the mirror is stale in a way row counts\n` +
        `cannot show. This is the case a report would get wrong silently.`,
    );
  }

  if (sourceBefore.rows === UNREACHABLE) {
    console.error("\nThe source is unreachable. Nothing to copy.");
    return 1;
  }
  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to replace the local database.");
    return 0;
  }

  // Owner-only. These files are complete database dumps -- password hashes,
  // MCP token hashes, every transaction -- and default permissions leave them
  // readable by any other account on the machine. chmod separately from mkdir
  // so an existing directory is tightened too, not just a freshly created one.
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  chmodSync(BACKUP_DIR, 0o700);
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
    chmodSync(backup, 0o600);

    console.log("Dumping the source...");
    runOn(SOURCE, "pg_dump", [
      "--no-owner",
      "--no-privileges",
      "--clean",
      "--if-exists",
      "-f",
      dump,
    ]);
    chmodSync(dump, 0o600);

    console.log("Restoring into the local database...");
    // --single-transaction with ON_ERROR_STOP: without it, psql autocommits each
    // statement, so a dump that fails partway -- a client/server mismatch, a
    // dependency the destination lacks -- stops with the local database already
    // half dropped. Wrapped, a failure rolls back and the existing mirror
    // survives, which is the difference between a failed refresh and a broken
    // development database.
    runOn(DEST, "psql", ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-f", dump]);
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
  console.log(`\nsource  ${line(sourceBefore)}   (read before the dump)`);
  console.log(`dest    ${line(after)}`);

  const matched =
    after.rows !== UNREACHABLE &&
    after.rows === sourceBefore.rows &&
    after.config === sourceBefore.config;
  console.log(
    matched
      ? "\nMatch. The local database is now a copy of the source."
      : "\nThe two do not match. Check the output above before trusting a report built on this.",
  );
  console.log(`\nTo undo:\n  ${undo}`);
  return matched ? 0 : 1;
}

process.exit(main());
