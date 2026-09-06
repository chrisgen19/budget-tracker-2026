/**
 * Reconcile `_prisma_migrations.checksum` with the migration files on disk.
 *
 * Prisma stores the SHA-256 of each migration.sql at the moment it is applied,
 * and refuses to run `migrate dev` when a stored checksum no longer matches its
 * file -- offering only to reset the database, which is not an option when the
 * development database is a mirror of production. Every later schema change
 * then has to be hand-written, which is how this repo's last one shipped.
 *
 * A mismatch is not automatically a problem. Editing a migration's *comments*
 * changes its checksum and nothing else, and so does adding a guard that only
 * refuses in conditions this database is not in. Both happened here:
 * `add_telegram_transaction_source` gained a comment block, and
 * `revert_accounts_and_transfers` gained a DO block that raises on databases
 * holding PR #187 data and is inert on the ones it already ran against.
 *
 * What this script does NOT do is decide that for you. It prints what changed
 * in every mismatched file and refuses to write unless `--apply` is passed,
 * because a mismatch caused by *schema* SQL being added means the database is
 * genuinely missing that change, and rewriting the checksum would bury it.
 *
 *   pnpm exec tsx --env-file=.env scripts/reconcile-migration-checksums.ts
 *   pnpm exec tsx --env-file=.env scripts/reconcile-migration-checksums.ts --apply
 *
 * A migration applied to the database with no file at all is a different
 * problem and belongs to check-migration-drift.ts; this script reports and
 * skips those rather than inventing a checksum for a file it cannot read.
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/** Prisma stores the plain SHA-256 of the file's bytes, hex-encoded. */
const checksumOf = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

type Row = { id: string; migration_name: string; checksum: string };
type Fix = {
  id: string;
  name: string;
  from: string;
  to: string;
  dirty: boolean;
  /** Commit whose version of the file the database actually ran, if findable. */
  appliedAt: string | null;
};

const git = (args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

/**
 * The file's committed bytes, not the working tree's.
 *
 * A checkout with `core.autocrlf` hands `readFileSync` CRLF while the
 * repository stores LF, so hashing the working file would store a checksum
 * specific to that workstation and recreate the mismatch for every Linux
 * deploy and every other developer -- with no migration having changed.
 * `.gitattributes` pins these files to LF as well; this is the belt.
 */
const canonicalBytes = (relPath: string): Buffer =>
  execFileSync("git", ["show", `HEAD:${relPath}`], { maxBuffer: 32 * 1024 * 1024 });

/**
 * Find the commit whose version of this file hashes to the stored checksum.
 *
 * The stored checksum is the *only* record of which SQL the database actually
 * ran, and this repo has had migrations applied from branches that were never
 * merged -- seven of them reached production within a minute of a branch push
 * (AGENTS.md, issue #192). So a same-named file in the current checkout is not
 * evidence of what ran, and reconciling without finding the real source would
 * overwrite the last trace of the difference and report clean forever after.
 *
 * Searched across all refs, so a branch still present locally is enough. Null
 * means the applied SQL exists nowhere in this repository's history, which is
 * the case that must be refused rather than blessed.
 */
const findAppliedBlob = (relPath: string, storedChecksum: string): string | null => {
  let revs: string[];
  try {
    revs = git(["log", "--all", "--format=%H", "--", relPath]).split("\n").filter(Boolean);
  } catch {
    return null;
  }
  for (const rev of revs) {
    try {
      const blob = execFileSync("git", ["show", `${rev}:${relPath}`], {
        maxBuffer: 32 * 1024 * 1024,
      });
      if (createHash("sha256").update(blob).digest("hex") === storedChecksum) return rev;
    } catch {
      // The file did not exist at that commit; keep walking.
    }
  }
  return null;
};

/**
 * Which database is about to be written to.
 *
 * `--env-file` does not override an already-exported DATABASE_URL, so the
 * documented invocation can silently target production from a shell that
 * happens to have it set. Names and checksum prefixes look identical across
 * environments, so without this the dry run gives no clue which one it read.
 */
const describeTarget = (): string => {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "DATABASE_URL is not set";
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "unparseable DATABASE_URL";
  }
};

/**
 * Whether a migration file has uncommitted edits.
 *
 * This is the normal case when `migrate dev` has just complained: the edit that
 * broke the checksum is in the working tree, not in history. Reviewing commits
 * alone would then show only safe past changes and hide the very edit in
 * question, so a dirty file is refused rather than reported.
 */
const dirtyFiles = (): Set<string> => {
  try {
    // --untracked-files=all, because the default collapses an untracked
    // *directory* to one entry with a trailing slash -- "?? prisma/migrations/
    // <name>/" -- which never matches the .../migration.sql path looked up
    // below. A migration copied from another branch or reconstructed locally is
    // exactly that shape, and would have been blessed as clean.
    const out = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all", "--", "prisma/migrations"],
      { encoding: "utf8" },
    );
    return new Set(
      out
        .split("\n")
        .filter(Boolean)
        // Renames read as "old -> new"; the new path is the one on disk.
        .map((line) => line.slice(3).trim().split(" -> ").pop()!.replace(/^"|"$/g, "")),
    );
  } catch {
    // Not a git checkout, or git unavailable. Reported by the caller rather than
    // assumed clean, since "cannot tell" and "is clean" are different answers.
    return new Set(["<git-unavailable>"]);
  }
};

const scan = async (dirty: Set<string>): Promise<{ fixes: Fix[]; missing: string[] }> => {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, migration_name, checksum
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at
  `;

  const fixes: Fix[] = [];
  const missing: string[] = [];

  for (const row of rows) {
    const rel = `prisma/migrations/${row.migration_name}/migration.sql`;
    const file = join(MIGRATIONS_DIR, row.migration_name, "migration.sql");
    if (!existsSync(file)) {
      missing.push(row.migration_name);
      continue;
    }
    // Hash the committed bytes where possible; fall back to the working tree
    // for a file git cannot show, which the dirty guard refuses anyway.
    let actual: string;
    try {
      actual = createHash("sha256").update(canonicalBytes(rel)).digest("hex");
    } catch {
      actual = checksumOf(file);
    }
    if (actual !== row.checksum) {
      fixes.push({
        id: row.id,
        name: row.migration_name,
        from: row.checksum,
        to: actual,
        appliedAt: findAppliedBlob(rel, row.checksum),
        // Prefix match as well as exact, so any git version or configuration
        // that still reports a directory rather than its files is caught.
        dirty:
          dirty.has("<git-unavailable>") ||
          [...dirty].some((d) => d === rel || rel.startsWith(d.endsWith("/") ? d : `${d}/`)),
      });
    }
  }
  return { fixes, missing };
};

const report = (fixes: Fix[], missing: string[]): void => {
  if (missing.length > 0) {
    console.log(
      `${missing.length} migration(s) are applied but have no file. That is drift, not a\n` +
        `checksum problem -- see scripts/check-migration-drift.ts:\n`,
    );
    for (const m of missing) console.log(`  - ${m}`);
    console.log("");
  }

  console.log(`${APPLY ? "Updating" : "Would update"} ${fixes.length} checksum(s):\n`);
  for (const f of fixes) {
    const tags = [f.dirty ? "UNCOMMITTED EDITS" : null, f.appliedAt ? null : "SOURCE NOT FOUND"]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${f.name}${tags ? `   [${tags}]` : ""}`);
    console.log(`    stored ${f.from.slice(0, 16)}...  file ${f.to.slice(0, 16)}...`);
    console.log(
      f.appliedAt
        ? `    applied from ${f.appliedAt.slice(0, 8)}`
        : `    the applied SQL matches no version of this file in any branch here`,
    );
  }

  const reviewable = fixes.filter((f) => f.appliedAt);
  if (reviewable.length > 0) {
    console.log(
      `\nDiff what the database ran against what is here now:\n` +
        reviewable
          .map(
            (f) =>
              `  git diff ${f.appliedAt!.slice(0, 8)} HEAD -- prisma/migrations/${f.name}/migration.sql`,
          )
          .join("\n"),
    );
  }
  console.log(
    `\nComments and guards are safe to reconcile. Added DDL is not -- that means the\n` +
      `database never received it, and rewriting the checksum would hide that.`,
  );
};

const applyFixes = async (fixes: Fix[]): Promise<void> => {
  // One transaction: a run interrupted midway would otherwise leave some
  // checksums reconciled and others not, which is a state nobody chose and the
  // next run cannot distinguish from a partial edit.
  await prisma.$transaction(
    fixes.map(
      (f) => prisma.$executeRaw`UPDATE _prisma_migrations SET checksum = ${f.to} WHERE id = ${f.id}`,
    ),
  );
  console.log(`\nUpdated ${fixes.length} checksum(s).`);
};

async function main() {
  console.log(`Target: ${describeTarget()}\n`);

  const dirty = dirtyFiles();
  const { fixes, missing } = await scan(dirty);

  if (fixes.length === 0) {
    console.log(
      missing.length > 0
        ? "Every applied migration whose file exists matches it. See the drift note above."
        : "Every applied migration's checksum matches its file.",
    );
    if (missing.length > 0) report(fixes, missing);
    return;
  }

  report(fixes, missing);

  const dirtyBlocked = fixes.filter((f) => f.dirty);
  if (APPLY && dirtyBlocked.length > 0) {
    console.log(
      `\nRefusing to apply. ${dirtyBlocked.length} of these file(s) have uncommitted edits, so\n` +
        `the change that broke the checksum is in the working tree and \`git log\` would not\n` +
        `show it -- exactly the case where blessing a checksum could bury real schema drift.\n` +
        `Commit or stash them, re-read the diff, then run again.`,
    );
    process.exitCode = 1;
    return;
  }

  const unsourced = fixes.filter((f) => !f.appliedAt);
  if (APPLY && unsourced.length > 0) {
    console.log(
      `\nRefusing to apply. For ${unsourced.length} of these, no version of the file in any\n` +
        `branch here hashes to what the database stored -- so the SQL that actually ran is not\n` +
        `in this repository, and the stored checksum is the only remaining evidence of that.\n` +
        `Overwriting it would report clean forever after.\n\n` +
        `This repo has had exactly that happen: migrations from unmerged branches reached\n` +
        `production within a minute of a branch push (AGENTS.md, issue #192). Fetch the\n` +
        `branch that produced them, or treat this as drift rather than a checksum problem.`,
    );
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply once you have read the diffs.");
    return;
  }

  await applyFixes(fixes);
}

main()
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
