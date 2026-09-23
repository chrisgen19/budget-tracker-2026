/**
 * Take a point-in-time backup of a remote database onto this machine.
 *
 * Coolify already backs the production database up nightly (18:00 UTC, seven kept locally plus
 * S3), which is the safety net for the accident nobody saw coming. This is the other thing: the
 * deliberate snapshot taken *immediately before* a migration reaches production, when "last night"
 * is not good enough and the file needs to be somewhere the deploy cannot touch.
 *
 *   pnpm exec tsx --env-file=.env.prod.local scripts/backup-prod-db.ts
 *   pnpm exec tsx scripts/backup-prod-db.ts --from "<url>"
 *
 * The connection string comes from `PROD_DATABASE_URL`, so the ordinary way to run this keeps it
 * out of argv and out of shell history. `--from` exists for a one-off against some other database
 * and is read the same way. `.env.prod.local` is covered twice over by .gitignore (`.env*.local`
 * and `.env.*`); it is not `.env`, because `DATABASE_URL` in that file is local by design and a
 * script that silently backed up localhost while reporting success is the failure this must not
 * have.
 *
 * Read-only. It runs `pg_dump` and nothing else, and writes only to the backup directory
 * (`~/db-backups` by default, or `--out <dir>`).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, chmodSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isLocalDatabase, databaseHost } from "./db-host";
import { versionSkew } from "./pg-version";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  const value = i >= 0 ? argv[i + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
};

const SOURCE = flag("from") ?? process.env.PROD_DATABASE_URL;
/**
 * Outside the repository by default.
 *
 * A dump is the whole production database, and the working tree is the one place on this machine
 * where a stray `git add -f`, a rogue tool or a misread .gitignore can turn a local file into a
 * published one. `.gitignore` still carries `.db-backups/` as a second line of defence for anyone
 * who points `--out` back inside the repo, but the default keeps it out of reach entirely.
 */
const BACKUP_DIR = flag("out") ?? join(homedir(), "db-backups");

/**
 * Split the password out of a connection string.
 *
 * Lifted from `refresh-local-mirror.ts` for the same reason it exists there: pg_dump takes the URL
 * as argv, so a password in it is visible to every process on the machine through `ps` for the
 * whole of the dump. PGPASSWORD is read from the environment, which `ps` does not show.
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
 * Refuse a source that permits an unencrypted connection.
 *
 * Same rule as `refresh-local-mirror.ts`: `disable`, `allow` and `prefer` all send the credentials
 * and the whole database in cleartext if the server does not insist otherwise, and this copies an
 * entire production database across that connection.
 */
const sslProblem = (url: string): string | null => {
  let mode: string | null;
  try {
    mode = new URL(url).searchParams.get("sslmode");
  } catch {
    return null;
  }
  if (mode === null) return "no sslmode= is set, so libpq may connect in cleartext";
  if (["disable", "allow", "prefer"].includes(mode)) return `sslmode=${mode} permits an unencrypted connection`;
  return null;
};

/**
 * Ask both sides their version and apply `versionSkew`. Only the two commands live here; the rule
 * and its tests are in `pg-version.ts`, which is importable and this file is not.
 */
const versionProblem = (url: string): string | null => {
  try {
    return versionSkew(
      runOn(url, "psql", ["-tAc", "show server_version"]).trim(),
      execFileSync("pg_dump", ["--version"], { encoding: "utf8" }),
    );
  } catch {
    return null;
  }
};

/** What the source holds, so the file has a figure to be checked against rather than just a size. */
const describe = (url: string): string => {
  try {
    return runOn(url, "psql", [
      "-tAc",
      "select count(*)||' transactions, newest '||coalesce(max(created_at)::date::text,'none') from transactions",
    ]).trim();
  } catch {
    return "unreachable";
  }
};

const guard = (source: string | undefined): source is string => {
  if (!source) {
    console.error("No connection string. Set PROD_DATABASE_URL (see .env.prod.local) or pass --from \"<url>\".");
    return false;
  }
  if (databaseHost(source) === null) {
    console.error("Refusing to run: that is not a connection string a host can be read from. Pass a full URL, quoted.");
    return false;
  }
  // Fails closed the same way the migrate guards do. A backup that quietly dumped this laptop while
  // printing "done" is worse than no backup, because it is believed.
  if (isLocalDatabase(source)) {
    console.error(
      `Refusing to run: that points at ${databaseHost(source)}, which is this machine.\n` +
        "This takes production backups. Use pg_dump directly for a local one.",
    );
    return false;
  }
  const ssl = sslProblem(source);
  if (ssl) {
    console.error(`Refusing to run: ${ssl}.\nThis copies an entire database across it. Add sslmode=require or stronger.`);
    return false;
  }
  return true;
};

function main(): number {
  if (!guard(SOURCE)) return 1;

  const host = databaseHost(SOURCE);
  const contents = describe(SOURCE);
  console.log(`source  ${host}   ${contents}`);
  if (contents === "unreachable") {
    console.error("\nThe source is unreachable. Nothing to back up.");
    return 1;
  }

  // After the reachability check, because it needs the connection the check just proved.
  const version = versionProblem(SOURCE);
  if (version) {
    console.error(`\nRefusing to run: ${version}.`);
    return 1;
  }

  // Owner-only. A dump is the whole database -- password hashes, MCP token hashes, every
  // transaction -- and default permissions leave it readable by any other account here. chmod
  // separately from mkdir so an existing directory is tightened too, not only a fresh one.
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  chmodSync(BACKUP_DIR, 0o700);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(BACKUP_DIR, `prod-${stamp}.dmp`);

  console.log(`\nDumping to ${file}`);
  // Custom format, matching what Coolify's own nightly job writes, so one restore procedure covers
  // either file. --no-owner/--no-privileges because the roles on this machine are not the roles
  // there, and a restore that fails on GRANT statements is a restore nobody completes under
  // pressure.
  runOn(SOURCE, "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "-f", file]);
  chmodSync(file, 0o600);

  // Reading the dump back is the only thing that distinguishes a backup from a file. A truncated
  // or half-written dump has a plausible size and restores into a half-populated database.
  // Not through `runOn`: this reads the local file and takes no connection string at all.
  const toc = execFileSync("pg_restore", ["-l", file], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const objects = toc.split("\n").filter((l) => l && !l.startsWith(";")).length;
  const size = statSync(file).size;
  console.log(`\nWrote ${size.toLocaleString()} bytes, ${objects} objects, verified readable by pg_restore.`);
  console.log(`\nRestore into a local database with:\n  pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" ${file}`);
  return 0;
}

process.exit(main());
