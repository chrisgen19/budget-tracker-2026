/**
 * Merge commute-fare descriptions stored several ways ("UV Express" / "UV express",
 * "UV & Jeep" / "Uv & Jeep" / "UV and Jeep", "Mini Bus" / "Minibus") into one spelling each.
 *
 * Why it matters: recurring-charge detection and the Telegram bot both key on description text,
 * so one fare split across spellings reads as several charges, and a fare whose spelling changed
 * is reported as having stopped. The grouping and the choice of canonical live in
 * `fare-spellings.ts`; see `fareKey` for what counts as the same spelling.
 *
 * Rewrites:
 *   - `transactions.description`
 *   - `telegram_quick_tiles.description`, since a tile carrying an old spelling writes it again
 *     on every tap
 *
 * `updated_via` is left alone: it records who edited a row through the app, MCP or Telegram, and
 * a maintenance rename is none of them. `updated_at` does move, through Prisma's `@updatedAt`.
 *
 * Each write is guarded on the exact old spelling, so a row edited since the plan was printed is
 * skipped rather than overwritten, and the whole run is one transaction.
 *
 * Dry run by default; APPLY=true writes. EMAIL=... limits it to one user.
 *
 *   pnpm exec tsx --env-file=.env scripts/merge-fare-spellings.ts
 *   pnpm exec tsx --env-file=.env scripts/merge-fare-spellings.ts APPLY=true
 *
 * Against production from a local checkout, put the URL on the command (a shell variable wins
 * over --env-file), and read the database line it prints before passing APPLY=true.
 */
import { PrismaClient } from "@prisma/client";
import { describeDatabaseUrl } from "../src/lib/database-identity";
import { planFareMerges, type FareMerge } from "./fare-spellings";

const prisma = new PrismaClient();

const arg = (key: string) =>
  process.argv.slice(2).find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1) ??
  process.env[key];

const APPLY = (arg("APPLY") ?? "").toLowerCase() === "true";
const EMAIL = arg("EMAIL");

type UserPlan = { userId: string; email: string; merges: FareMerge[] };

const planForUser = async (userId: string, email: string): Promise<UserPlan> => {
  const rows = await prisma.transaction.groupBy({
    by: ["description"],
    where: { userId },
    _count: { _all: true },
    _max: { date: true },
  });
  const uses = rows.map((r) => ({
    description: r.description,
    count: r._count._all,
    lastUsed: r._max.date ?? new Date(0),
  }));
  return { userId, email, merges: planFareMerges(uses) };
};

const printPlan = (plan: UserPlan) => {
  console.log(`${plan.email}`);
  for (const m of plan.merges) {
    const moved = m.variants.reduce((n, v) => n + v.count, 0);
    console.log(`  -> "${m.canonical}"  (${moved} row${moved === 1 ? "" : "s"} to rewrite)`);
    for (const v of m.variants) console.log(`       "${v.description}"  x${v.count}`);
  }
};

/**
 * The batch form of `$transaction`, not the interactive one: against a remote database every
 * awaited statement is a round trip, and two per variant overran the interactive form's 5s
 * timeout on production. The batch is still one transaction, all or nothing.
 */
const applyPlan = async (plan: UserPlan) => {
  const pairs = plan.merges.flatMap((m) =>
    m.variants.map((v) => {
      const where = { userId: plan.userId, description: v.description };
      const data = { description: m.canonical };
      return [prisma.transaction.updateMany({ where, data }), prisma.telegramQuickTile.updateMany({ where, data })];
    }),
  );
  const results = await prisma.$transaction(pairs.flat());
  const sum = (offset: number) =>
    results.filter((_, i) => i % 2 === offset).reduce((n, r) => n + r.count, 0);
  return { transactions: sum(0), tiles: sum(1) };
};

const main = async () => {
  // Printed before any query, so every exit says which database it was talking to.
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} on ${describeDatabaseUrl(process.env.DATABASE_URL)}\n`);

  const users = await prisma.user.findMany({
    where: EMAIL ? { email: EMAIL } : {},
    select: { id: true, email: true },
  });
  if (EMAIL && users.length === 0) throw new Error(`No user with email ${EMAIL}`);

  const plans = (await Promise.all(users.map((u) => planForUser(u.id, u.email)))).filter(
    (p) => p.merges.length > 0,
  );
  if (plans.length === 0) {
    console.log("Nothing to merge: every fare has one spelling.");
    return;
  }

  for (const plan of plans) {
    printPlan(plan);
    const tiles = await prisma.telegramQuickTile.findMany({
      where: {
        userId: plan.userId,
        description: { in: plan.merges.flatMap((m) => m.variants.map((v) => v.description)) },
      },
      select: { label: true, description: true },
    });
    for (const t of tiles) console.log(`  quick tile "${t.label}" writes "${t.description}"`);
    console.log("");
  }

  if (!APPLY) {
    console.log("Dry run. Re-run with APPLY=true to rewrite these.");
    return;
  }

  for (const plan of plans) {
    const done = await applyPlan(plan);
    console.log(`${plan.email}: ${done.transactions} transactions, ${done.tiles} quick tiles rewritten`);
  }
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
