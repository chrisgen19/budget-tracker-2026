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
 * What this script does NOT do is decide that for you. It prints the diff of
 * every mismatched file since the commit that introduced it and refuses to
 * write unless `--apply` is passed, because a mismatch caused by *schema* SQL
 * being added means the database is genuinely missing that change, and
 * rewriting the checksum would bury it. Read the diff first.
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
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/** Prisma stores the plain SHA-256 of the file's bytes, hex-encoded. */
const checksumOf = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

type Row = { id: string; migration_name: string; checksum: string };

async function main() {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, migration_name, checksum
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at
  `;

  const fixes: Array<{ id: string; name: string; from: string; to: string }> = [];
  const missing: string[] = [];

  for (const row of rows) {
    const file = join(MIGRATIONS_DIR, row.migration_name, "migration.sql");
    if (!existsSync(file)) {
      missing.push(row.migration_name);
      continue;
    }
    const actual = checksumOf(file);
    if (actual !== row.checksum) {
      fixes.push({ id: row.id, name: row.migration_name, from: row.checksum, to: actual });
    }
  }

  if (missing.length > 0) {
    console.log(
      `${missing.length} migration(s) are applied but have no file. That is drift, not a\n` +
        `checksum problem -- see scripts/check-migration-drift.ts:\n`,
    );
    for (const m of missing) console.log(`  - ${m}`);
    console.log("");
  }

  if (fixes.length === 0) {
    console.log("Every applied migration's checksum matches its file.");
    return;
  }

  console.log(`${APPLY ? "Updating" : "Would update"} ${fixes.length} checksum(s):\n`);
  for (const f of fixes) {
    console.log(`  ${f.name}`);
    console.log(`    stored ${f.from.slice(0, 16)}...  file ${f.to.slice(0, 16)}...`);
  }
  console.log(
    `\nBefore applying, read what changed in each file since it was applied:\n` +
      fixes.map((f) => `  git log -p -- prisma/migrations/${f.name}/migration.sql`).join("\n") +
      `\n\nComments and guards are safe to reconcile. Added DDL is not -- that means the\n` +
      `database never received it, and rewriting the checksum would hide that.`,
  );

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply once you have read the diffs.");
    return;
  }

  for (const f of fixes) {
    await prisma.$executeRaw`
      UPDATE _prisma_migrations SET checksum = ${f.to} WHERE id = ${f.id}
    `;
  }
  console.log(`\nUpdated ${fixes.length} checksum(s).`);
}

main()
  .catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
