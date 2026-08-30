/**
 * Resolve `DATABASE_URL` the way the Prisma CLI does, for scripts that run in both places.
 *
 * The rest of `scripts/` is invoked by hand with `tsx --env-file=.env`, which is fine for a
 * one-off. The two callers here are not: `check-migration-drift.ts` runs inside `pnpm build`, in a
 * container that has no `.env` at all and where `--env-file` would fail outright on the missing
 * file, and `guard-local-db.ts` has to see exactly the URL Prisma is about to use or it guards
 * nothing.
 *
 * "The way Prisma does" is load-bearing, not a nicety. Every divergence between this parser and
 * the dotenv Prisma bundles is a case where the guard clears one database and Prisma writes to
 * another -- which is the incident that produced this whole PR. The rules below were each checked
 * against `prisma migrate status` on a real `.env`, not read off the documentation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pull one key out of `.env` contents, following dotenv's rules.
 *
 * Three of these were verified by feeding the file to `prisma migrate status` and reading back the
 * datasource it resolved:
 *
 * - **The last assignment wins.** dotenv parses into an object in a loop, so a later line
 *   overwrites an earlier one. Returning the *first* match instead is the dangerous direction: a
 *   `.env` keeping a dev URL above a production one -- an ordinary way to keep both to hand --
 *   would have the guard read localhost while Prisma migrated production.
 * - **A quoted value ends at its closing quote**, so a `#` inside the quotes belongs to the value
 *   (a generated password contains one often enough) and anything after the quote is a comment.
 * - **An unquoted value ends at the first `#`**, whitespace or no whitespace: dotenv matches an
 *   unquoted value as `[^#\r\n]+`. Prisma reads `DATABASE_URL=postgres://u:p@host/db#x` as
 *   `postgres://u:p@host/db`, so this must too.
 */
export const parseEnvValue = (contents: string, key: string): string | undefined => {
  let found: string | undefined;

  for (const line of contents.split("\n")) {
    // The separator is dotenv's, character for character: `\s*=\s*` or `:\s+`. The two halves
    // differ, and the difference is load-bearing -- a colon takes no whitespace before it and
    // *requires* whitespace after. Probed against `prisma migrate status`: `KEY: v` is read,
    // `KEY:v` and `KEY \t: v` are both ignored, `KEY =v` is read. A looser separator here is a
    // silent bypass rather than a leniency: a `.env` holding a remote URL above a typo'd
    // `DATABASE_URL:postgresql://localhost/db` had Prisma use the remote line, this parser take
    // the localhost one, and the guard wave the migration through.
    const match = line.match(/^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*|:\s+)(.*)$/);
    if (!match || match[1] !== key) continue;

    const raw = match[2].trim();

    // Lazy, so the *first* closing quote ends the value. Greedy reaches for the last quote on the
    // line, which a comment like `# note about "quotes"` supplies -- swallowing the comment into
    // the value it was written beside.
    const quoted = raw.match(/^(['"`])([\s\S]*?)\1/);

    // Deliberately no `continue` on a later line that fails to parse: dotenv would have
    // overwritten the earlier value too, and keeping the older one would once again mean guarding
    // a URL nobody is about to use.
    found = quoted ? quoted[2] : raw.split("#")[0].trim();
  }

  return found;
};

/** Read one key out of the `.env` beside the working directory, if there is one. */
const readFromEnvFile = (key: string): string | undefined => {
  try {
    return parseEnvValue(readFileSync(join(process.cwd(), ".env"), "utf8"), key);
  } catch {
    return undefined;
  }
};

/**
 * The connection string Prisma would use, or `undefined` if neither source has one.
 *
 * `process.env` wins over the file, matching Prisma. Node's own `--env-file` inverts that -- the
 * file overrides the environment -- which for the guard is the difference between reading
 * localhost out of `.env` and refusing the production URL someone actually passed on the command
 * line. That inversion is the exact shape of the accident the guard exists to prevent.
 *
 * Prisma also reads `prisma/.env`. Measured on 6.19.2, the root `.env` still wins when both define
 * the key, so the dangerous direction does not arise; the residue is that a key living *only* in
 * `prisma/.env` is invisible here, and the guard then refuses for want of a URL rather than
 * clearing the wrong one. That is the safe way round, and this file is not the place to fix it.
 */
export const resolveDatabaseUrl = (): string | undefined =>
  process.env.DATABASE_URL || readFromEnvFile("DATABASE_URL") || undefined;
