/**
 * Seed the Telegram Mini App's quick-log buttons for one account.
 *
 * The three fixed fares are the ones `QUICK_FARES` already pins to the reply keyboard, carried
 * across so the Mini App opens with something in it rather than an empty grid. The three
 * ask-for-an-amount tiles are the ones a reply keyboard could never offer: a button sends its label
 * verbatim, so it cannot pause to ask "how much?", which is why Grab, taxi and a variable lunch
 * never got one.
 *
 * Deliberately **not** part of `pnpm db:seed`, and never part of a build. It writes rows for one
 * named user, which is not a thing a deploy should decide, and re-running it after someone has
 * renamed their buttons should not quietly restore the originals.
 *
 * **It seeds an empty grid and does nothing else.** An account that already has a single tile is
 * reported and left completely alone.
 *
 * Per-label deduplication was the obvious alternative and is quietly wrong, because a label is the
 * one field the editor exists to change. Rename "To office" to "Office" and its original label is
 * free again, so the next run recreates it beside the renamed one -- restoring exactly the button
 * somebody had deliberately edited, and pushing the account one tile closer to `MAX_QUICK_TILES`
 * every time. Nothing distinguishes a seeded row from a hand-made one after the fact, and adding a
 * column to mark them is a schema change to serve a script that runs once.
 *
 * All-or-nothing also means the cap cannot be breached: the list below is shorter than
 * `MAX_QUICK_TILES` and only ever lands in an empty grid.
 *
 * Usage:
 *   EMAIL=you@example.com pnpm exec tsx --env-file=.env \
 *     scripts/seed-telegram-quick-tiles.ts            # dry run (default)
 *   ... scripts/seed-telegram-quick-tiles.ts --apply  # actually write
 *
 * Inside a Coolify container drop `--env-file`, since the variables are already set. Note `tsx` is
 * a devDependency and may be absent from the standalone image, in which case run it locally
 * against the production DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { MAX_QUICK_TILES, resolveTileCategory, SORT_ORDER_GAP } from "../src/lib/telegram/quick-tiles";
import type { BotCategory } from "../src/lib/telegram/category-match";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const email = process.env.EMAIL?.trim();

/**
 * The starting set.
 *
 * `label` is what the button reads and `description` is what lands in the ledger; they differ
 * where the short version would be useless a year later. `amount: null` means the tile opens the
 * numeric pad.
 *
 * No `categoryId` here on purpose. Category ids are per-database, so hardcoding one would make
 * this script wrong everywhere but the machine it was written on. Every description below resolves
 * through the real `matchCategory` to Transportation or Food & Dining, which the run reports so a
 * surprise is visible before anything is written.
 */
const TILES = [
  { label: "To office", description: "fare to office", amount: 38 },
  { label: "Home (UV)", description: "fare home (UV)", amount: 80 },
  { label: "Home (UV+jeep)", description: "fare home (UV + jeep)", amount: 95 },
  { label: "Fare to office", description: "fare to office", amount: null },
  { label: "Lunch at work", description: "lunch at work", amount: null },
  { label: "Office to home", description: "fare office to home", amount: null },
] as const;

async function main() {
  console.log(`[seed-telegram-quick-tiles] mode: ${apply ? "APPLY" : "DRY RUN"}`);

  // Checked rather than assumed, because the empty-grid guard below is what keeps the cap out of
  // reach: it is only safe while this list is the shorter of the two.
  if (TILES.length > MAX_QUICK_TILES) {
    throw new Error(
      `TILES has ${TILES.length} entries but MAX_QUICK_TILES is ${MAX_QUICK_TILES}.`
    );
  }

  if (!email) {
    throw new Error("EMAIL is required, e.g. EMAIL=you@example.com");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, telegramUserId: true },
  });

  if (!user) {
    throw new Error(`No user with email ${email}`);
  }

  // Worth saying rather than failing: the tiles are perfectly valid without a link, they are just
  // unreachable until one exists. Someone seeding before linking should be told, not stopped.
  if (!user.telegramUserId) {
    console.warn(
      `  note: ${user.email} has no telegram_user_id, so the Mini App cannot open for them yet. ` +
        "Run scripts/link-telegram-user.ts."
    );
  }

  const categories: BotCategory[] = await prisma.category.findMany({
    where: { OR: [{ isDefault: true }, { userId: user.id }] },
    select: { id: true, name: true, type: true },
  });

  const existing = await prisma.telegramQuickTile.count({ where: { userId: user.id } });

  // The whole guard, and it is deliberately blunt. Anything finer has to decide which existing
  // tiles "are" the seeded ones, and after a rename nothing can tell.
  if (existing > 0) {
    console.log(
      `  ${user.email} already has ${existing} tile(s), so there is nothing to seed. ` +
        "Add or edit buttons in the Mini App instead."
    );
    return;
  }

  let order = SORT_ORDER_GAP;
  let created = 0;

  for (const tile of TILES) {
    // Resolved and printed rather than assumed. These descriptions are chosen to land on
    // Transportation and Food & Dining through the real matcher, and if one ever stops doing so
    // the run says which before writing anything.
    const resolved = resolveTileCategory(
      { description: tile.description, type: "EXPENSE", categoryId: null },
      categories
    );

    if (!resolved) {
      throw new Error(
        `"${tile.description}" resolves to no category at all, not even an "Other" one. ` +
          "Seed the default categories first (pnpm db:seed)."
      );
    }

    const money = tile.amount === null ? "asks" : String(tile.amount);
    console.log(`  create ${tile.label} (${money}) -> ${resolved.categoryName}`);

    if (apply) {
      await prisma.telegramQuickTile.create({
        data: {
          userId: user.id,
          label: tile.label,
          description: tile.description,
          amount: tile.amount,
          type: "EXPENSE",
          // Stored explicitly rather than left null. The tile is the user's own choice from here
          // on, and leaving it to be re-derived on every tap would let a later change to the
          // keyword hints silently move where an existing button files.
          categoryId: resolved.categoryId,
          sortOrder: order,
        },
      });
      created += 1;
    }

    order += SORT_ORDER_GAP;
  }

  if (!apply) {
    console.log("Dry run -- nothing written. Re-run with --apply.");
    return;
  }

  console.log(`Created ${created} tile(s).`);
}

main()
  .catch((err) => {
    console.error("[seed-telegram-quick-tiles]", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
