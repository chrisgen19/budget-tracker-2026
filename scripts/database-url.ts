/**
 * Resolve `DATABASE_URL` the way the Prisma CLI does, for scripts that run in both places.
 *
 * The rest of `scripts/` is invoked by hand with `tsx --env-file=.env`, which is fine for a
 * one-off. The two callers here are not: `check-migration-drift.ts` runs inside `pnpm build`, in a
 * container that has no `.env` at all and where `--env-file` would fail outright on the missing
 * file, and `guard-local-db.ts` has to see exactly the URL Prisma is about to use or it guards
 * nothing.
 *
 * `process.env` wins over the file, matching Prisma. Node's own `--env-file` inverts that -- the
 * file overrides the environment -- which for the guard is the difference between reading localhost
 * out of `.env` and refusing the production URL someone actually passed on the command line. That
 * inversion is the exact shape of the accident the guard exists to prevent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Pull one key out of a `.env` file, handling `export`, quotes and trailing comments. */
const readFromEnvFile = (key: string): string | undefined => {
  let contents: string;
  try {
    contents = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch {
    return undefined;
  }

  for (const line of contents.split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!match || match[1] !== key) continue;

    const raw = match[2].trim();
    const quoted = raw.match(/^(['"])([\s\S]*)\1$/);
    // Only strip a trailing comment from an unquoted value: a `#` inside quotes is part of the
    // value, and a password is exactly the kind of value that contains one.
    return quoted ? quoted[2] : raw.replace(/\s+#.*$/, "");
  }
  return undefined;
};

/** The connection string Prisma would use, or `undefined` if neither source has one. */
export const resolveDatabaseUrl = (): string | undefined =>
  process.env.DATABASE_URL || readFromEnvFile("DATABASE_URL") || undefined;
