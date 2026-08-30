/**
 * Resolve `DATABASE_URL` the way the Prisma CLI does, for scripts that run in both places.
 *
 * The rest of `scripts/` is invoked by hand with `tsx --env-file=.env`, which is fine for a
 * one-off. The two callers here are not: `check-migration-drift.ts` runs inside `pnpm build`, in a
 * container that has no `.env` at all and where `--env-file` would fail outright on the missing
 * file, and `guard-local-db.ts` has to see exactly the URL Prisma is about to use or it guards
 * nothing.
 *
 * "The way Prisma does" is load-bearing, not a nicety: every divergence between this and the parser
 * Prisma uses is a case where the guard clears one database and Prisma writes to another, which is
 * the incident that produced this whole PR.
 *
 * So it does not reimplement the grammar, it calls it. This file previously hand-rolled a regex,
 * and review found four separate divergences from dotenv in four rounds -- first-vs-last
 * assignment, the `#` rule, quoting-versus-comment order, and a separator that accepted
 * `KEY:value`, which dotenv ignores. Three of the four let the guard clear a URL Prisma was not
 * about to use. The lesson was not that any one regex was wrong; it was that a component whose only
 * job is to agree with another parser should not be a second implementation of it.
 */
import { parse as parseDotenv } from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One key out of `.env` contents, parsed by dotenv itself.
 *
 * Pinned to `^16.6.1` in package.json rather than `^17`, deliberately. Prisma 6.19.2 parses `.env`
 * with a dotenv it *bundles* into `prisma/build/index.js`, and its dependency chain
 * (prisma > @prisma/config > c12 > dotenv) resolves 16.6.1. The `LINE` regex in the installed
 * 16.6.1 and the one bundled in Prisma's build output were compared and are byte-for-byte
 * identical, so this range means the guard shares Prisma's actual grammar and pnpm dedupes to the
 * copy already in the tree instead of installing a second one. Bumping the major would quietly
 * re-open the divergence this replaced.
 */
export const parseEnvValue = (contents: string, key: string): string | undefined =>
  parseDotenv(contents)[key];

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
 * `process.env` wins over the file, matching Prisma -- and matching dotenv's own `config()`, which
 * does not overwrite a variable already set. Node's `--env-file` inverts that, which for the guard
 * is the difference between reading localhost out of `.env` and refusing the production URL
 * someone actually passed on the command line. That inversion is the exact shape of the accident
 * the guard exists to prevent, which is why the file is read here rather than by a Node flag.
 *
 * Prisma also reads `prisma/.env`. Measured on 6.19.2, the root `.env` still wins when both define
 * the key, so the dangerous direction does not arise; the residue is that a key living *only* in
 * `prisma/.env` is invisible here, and the guard then refuses for want of a URL rather than
 * clearing the wrong one. That is the safe way round.
 */
export const resolveDatabaseUrl = (): string | undefined =>
  process.env.DATABASE_URL || readFromEnvFile("DATABASE_URL") || undefined;
