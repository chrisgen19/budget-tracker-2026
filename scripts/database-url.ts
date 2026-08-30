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

/**
 * Pull one key out of `.env` contents, handling `export`, quotes and trailing comments.
 *
 * The two comment rules differ, and both matter. A quoted value ends at its closing quote, so a
 * `#` *inside* the quotes is part of the value -- a generated database password contains one often
 * enough -- while anything after the closing quote is a comment. An unquoted value has no closing
 * mark, so only ` #` preceded by whitespace ends it, leaving a bare `#` mid-value alone.
 *
 * Exported for its own test: the closing quote and the trailing comment have to be handled in that
 * order. Stripping the comment first leaves the quotes attached to the value, and `new URL()` then
 * rejects a perfectly good connection string.
 */
export const parseEnvValue = (contents: string, key: string): string | undefined => {
  for (const line of contents.split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!match || match[1] !== key) continue;

    const raw = match[2].trim();
    // Lazy, so the *first* closing quote ends the value. Greedy reaches for the last quote on the
    // line, which a comment like `# note about "quotes"` supplies -- swallowing the comment into
    // the value it was written beside.
    const quoted = raw.match(/^(['"])([\s\S]*?)\1\s*(?:#.*)?$/);
    return quoted ? quoted[2] : raw.replace(/\s+#.*$/, "");
  }
  return undefined;
};

/** Read one key out of the `.env` beside the working directory, if there is one. */
const readFromEnvFile = (key: string): string | undefined => {
  try {
    return parseEnvValue(readFileSync(join(process.cwd(), ".env"), "utf8"), key);
  } catch {
    return undefined;
  }
};

/** The connection string Prisma would use, or `undefined` if neither source has one. */
export const resolveDatabaseUrl = (): string | undefined =>
  process.env.DATABASE_URL || readFromEnvFile("DATABASE_URL") || undefined;
