/**
 * Refuse to run a dev-only Prisma command against a database that is not on this machine.
 *
 * `prisma migrate dev` and `prisma db push` write schema. Both are fronted by a one-word pnpm
 * script, and neither says which database it is about to change -- so whichever `DATABASE_URL` is
 * in scope at that moment is the one that gets altered, and the two look identical from the
 * terminal. That is how two migrations from a closed PR reached production: they were applied to
 * the live database seconds after being generated, and nothing downstream noticed for four deploys.
 *
 * Gates `db:migrate` and `db:push` only. `db:seed` is deliberately left open -- AGENTS.md documents
 * running it against production from a Coolify terminal after promoting a default category -- as is
 * `db:studio`, where inspecting production is a normal thing to want.
 *
 * This is a guard rail, not a security boundary: a direct `prisma migrate dev` walks straight past
 * it. It exists to make the accident hard to reach by muscle memory, which is how it happened.
 *
 * Usage (from package.json):
 *   tsx scripts/guard-local-db.ts && prisma migrate dev
 *
 * Override for a deliberate remote run:
 *   ALLOW_REMOTE_DB=1 pnpm db:push
 */
import { resolveDatabaseUrl } from "./database-url";
import { databaseHost, isLocalDatabase } from "./db-host";

const OVERRIDE = "ALLOW_REMOTE_DB";

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  console.error("[guard-local-db] DATABASE_URL is not set — refusing to run a schema command.");
  process.exit(1);
}

if (isLocalDatabase(databaseUrl)) {
  process.exit(0);
}

// Named where it can be, so the message says which database was refused. An unparseable URL is
// still refused: the point of the guard is knowing where the write lands, and there we do not.
const host = databaseHost(databaseUrl) ?? "an address that could not be parsed";

if (process.env[OVERRIDE] === "1") {
  console.warn(`[guard-local-db] ${OVERRIDE}=1 — proceeding against ${host}`);
  process.exit(0);
}

console.error(
  `[guard-local-db] DATABASE_URL points at ${host}, which is not this machine.\n` +
    "\n" +
    "  pnpm db:migrate and pnpm db:push write schema. Running either against a deployed database\n" +
    "  applies migrations that are not in this repository's history, and nothing in the deploy\n" +
    "  pipeline reports that afterwards.\n" +
    "\n" +
    "  Migrations reach production by merging to main and letting Coolify deploy them.\n" +
    `  If you really mean to do this here, re-run with ${OVERRIDE}=1.`
);
process.exit(1);
