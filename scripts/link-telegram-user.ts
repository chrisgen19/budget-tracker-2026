/**
 * Link a Telegram account to an app user, so the Mini App can act as them.
 *
 * `users.telegram_user_id` is the identity half of the Mini App's gate (the other half is
 * `TELEGRAM_ALLOWED_IDS`). It is set here rather than through a linking flow in the app: a
 * one-time-code exchange is a whole feature, and this deployment has one person to link. If this
 * ever serves more than one, that is the point to build the flow -- not before.
 *
 * Finding your Telegram id: message the bot once from the account you want to link. A denied
 * sender's numeric id is logged by `bot.ts`, and an allowed one appears in `TELEGRAM_ALLOWED_IDS`
 * already.
 *
 * Usage:
 *   EMAIL=you@example.com TELEGRAM_ID=42424242 pnpm exec tsx --env-file=.env \
 *     scripts/link-telegram-user.ts            # dry run (default)
 *   ... scripts/link-telegram-user.ts --apply  # actually write
 *
 * To unlink, pass TELEGRAM_ID="" (or --unlink) with --apply.
 *
 * Inside a Coolify container drop `--env-file`, since the variables are already set. Note `tsx` is
 * a devDependency and may be absent from the standalone image, in which case run this locally
 * against the production DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const unlink = process.argv.includes("--unlink") || process.env.TELEGRAM_ID === "";

const email = process.env.EMAIL?.trim();
const telegramId = process.env.TELEGRAM_ID?.trim();

async function main() {
  console.log(`[link-telegram-user] mode: ${apply ? "APPLY" : "DRY RUN"}`);

  if (!email) {
    throw new Error("EMAIL is required, e.g. EMAIL=you@example.com");
  }

  // Matched as text, and required to be a positive integer with no leading zero -- the same shape
  // `menuRegistrations` insists on. `Number("")` is 0, a perfectly safe integer that would write a
  // link to a Telegram account nobody meant.
  if (!unlink && (!telegramId || !/^[1-9]\d*$/.test(telegramId))) {
    throw new Error(
      "TELEGRAM_ID must be a positive integer, e.g. TELEGRAM_ID=42424242 " +
        '(pass --unlink, or TELEGRAM_ID="", to clear it)'
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, telegramUserId: true },
  });

  if (!user) {
    throw new Error(`No user with email ${email}`);
  }

  const next = unlink ? null : telegramId!;

  console.log(`  user:     ${user.name} <${user.email}>`);
  console.log(`  current:  ${user.telegramUserId ?? "(none)"}`);
  console.log(`  next:     ${next ?? "(none)"}`);

  if (user.telegramUserId === next) {
    console.log("Already set. Nothing to do.");
    return;
  }

  // Reported before writing rather than surfaced as a raw P2002. The column is unique so two app
  // users cannot claim one Telegram account, and the useful thing to say is *which* account holds
  // it -- the likely cause is a re-run against the wrong email.
  if (next) {
    const claimed = await prisma.user.findUnique({
      where: { telegramUserId: next },
      select: { email: true },
    });
    if (claimed) {
      throw new Error(
        `Telegram id ${next} is already linked to ${claimed.email}. ` +
          "Unlink that account first."
      );
    }
  }

  if (!apply) {
    console.log("Dry run -- nothing written. Re-run with --apply.");
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { telegramUserId: next } });
  console.log(`Linked. ${next ? "The Mini App can now act as this user." : "Link cleared."}`);

  // Worth saying every time: the link is only half the gate, and the half people forget is the
  // one that is not in the database.
  if (next) {
    console.log(
      `Remember TELEGRAM_ALLOWED_IDS must also contain ${next}, or the Mini App still refuses.`
    );
  }
}

main()
  .catch((err) => {
    console.error("[link-telegram-user]", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
